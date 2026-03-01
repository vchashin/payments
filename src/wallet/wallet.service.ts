import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TopupDto } from './dto/topup.dto';
import { ChargeDto } from './dto/charge.dto';
import { BalanceQueryDto } from './dto/balance-query.dto';
import {
  IdempotencyConflictException,
  InsufficientFundsException,
  LimitExceededException,
} from './exceptions/wallet.exceptions';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class WalletService {
  private readonly dailyLimit: Prisma.Decimal;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.dailyLimit = new Prisma.Decimal(
      this.config.get('DAILY_CHARGE_LIMIT') ?? 10000,
    );
  }

  async topup(dto: TopupDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({
          where: { key: dto.idempotencyKey },
        });
        if (existing) {
          if (existing.operationType !== 'TOPUP') {
            throw new IdempotencyConflictException();
          }
          return existing.responseBody;
        }

        const amount = new Prisma.Decimal(dto.amount);

        const wallet = await tx.wallet.upsert({
          where: {
            userId_currency: { userId: dto.userId, currency: dto.currency },
          },
          create: {
            userId: dto.userId,
            currency: dto.currency,
            balance: amount,
          },
          update: { balance: { increment: amount } },
        });

        const transaction = await tx.transaction.create({
          data: {
            userId: dto.userId,
            currency: dto.currency,
            amount,
            type: 'TOPUP',
            idempotencyKey: dto.idempotencyKey,
          },
        });

        const response = {
          balance: wallet.balance,
          transactionId: transaction.id,
        };

        await tx.idempotencyRecord.create({
          data: {
            key: dto.idempotencyKey,
            operationType: 'TOPUP',
            responseBody: response,
          },
        });

        return response;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Two concurrent requests with the same key: the losing transaction
        // hit a unique-constraint violation. Fetch and return the winner's result.
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: { key: dto.idempotencyKey },
        });
        if (existing?.operationType !== 'TOPUP') {
          throw new IdempotencyConflictException();
        }
        return existing.responseBody;
      }
      throw e;
    }
  }

  async charge(dto: ChargeDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({
          where: { key: dto.idempotencyKey },
        });
        if (existing) {
          if (existing.operationType !== 'CHARGE') {
            throw new IdempotencyConflictException();
          }
          return existing.responseBody;
        }

        const amount = new Prisma.Decimal(dto.amount);

        // Pessimistic lock on the wallet row
        const rows = await tx.$queryRaw<
          { balance: Prisma.Decimal }[]
        >`SELECT balance FROM wallets WHERE "userId" = ${dto.userId} AND currency = ${dto.currency} FOR UPDATE`;

        const wallet = rows[0];
        if (!wallet || wallet.balance.lessThan(amount)) {
          throw new InsufficientFundsException();
        }

        // UTC start-of-day for the daily limit window
        const now = new Date();
        const utcToday = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );

        // Ensure the daily_usage row exists, then lock it with FOR UPDATE so
        // concurrent charge transactions are fully serialized on this counter.
        await tx.$executeRaw`
          INSERT INTO daily_usage ("userId", currency, date, total)
          VALUES (${dto.userId}, ${dto.currency}, ${utcToday}::date, 0)
          ON CONFLICT ("userId", currency, date) DO NOTHING
        `;

        // SELECT FOR UPDATE in any isolation level reads the latest committed
        // version, so T2 will see T1's committed increment after unblocking.
        const [usage] = await tx.$queryRaw<{ total: Prisma.Decimal }[]>`
          SELECT total FROM daily_usage
          WHERE "userId" = ${dto.userId} AND currency = ${dto.currency}
            AND date = ${utcToday}::date
          FOR UPDATE
        `;

        if (usage.total.add(amount).greaterThan(this.dailyLimit)) {
          throw new LimitExceededException();
        }

        const updated = await tx.wallet.update({
          where: {
            userId_currency: { userId: dto.userId, currency: dto.currency },
          },
          data: { balance: { decrement: amount } },
        });

        const transaction = await tx.transaction.create({
          data: {
            userId: dto.userId,
            currency: dto.currency,
            amount,
            type: 'CHARGE',
            reason: dto.reason,
            idempotencyKey: dto.idempotencyKey,
          },
        });

        await tx.$executeRaw`
          UPDATE daily_usage SET total = total + ${amount}
          WHERE "userId" = ${dto.userId} AND currency = ${dto.currency}
            AND date = ${utcToday}::date
        `;

        const response = {
          balance: updated.balance,
          transactionId: transaction.id,
        };

        await tx.idempotencyRecord.create({
          data: {
            key: dto.idempotencyKey,
            operationType: 'CHARGE',
            responseBody: response,
          },
        });

        return response;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.idempotencyRecord.findUnique({
          where: { key: dto.idempotencyKey },
        });
        if (existing?.operationType !== 'CHARGE') {
          throw new IdempotencyConflictException();
        }
        return existing.responseBody;
      }
      throw e;
    }
  }

  async getBalance(dto: BalanceQueryDto) {
    const where: Prisma.WalletWhereInput = { userId: dto.userId };
    if (dto.currency) where.currency = dto.currency;

    const [wallets, transactions] = await Promise.all([
      this.prisma.wallet.findMany({ where }),
      this.prisma.transaction.findMany({
        where: {
          userId: dto.userId,
          ...(dto.currency ? { currency: dto.currency } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: dto.limit,
      }),
    ]);

    return {
      balances: wallets.map((w) => ({
        currency: w.currency,
        balance: w.balance,
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        reason: t.reason,
        createdAt: t.createdAt,
      })),
    };
  }
}
