import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  IdempotencyConflictException,
  InsufficientFundsException,
  LimitExceededException,
} from './exceptions/wallet.exceptions';
import { Prisma } from '../../generated/prisma/client';

const D = (v: number | string) => new Prisma.Decimal(v);

const mockTx = {
  idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  wallet: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  transaction: { create: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
};

const mockPrisma = {
  $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
  idempotencyRecord: { findUnique: jest.fn() },
  wallet: { findMany: jest.fn() },
  transaction: { findMany: jest.fn() },
};

const mockConfig = { get: jest.fn().mockReturnValue('10000') };

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  // ─── topup ────────────────────────────────────────────────────────────────

  describe('topup', () => {
    const dto = {
      userId: 'u1',
      amount: '500',
      currency: 'RUB',
      idempotencyKey: 'key-1',
    };

    it('credits balance and returns result', async () => {
      mockTx.idempotencyRecord.findUnique.mockResolvedValue(null);
      mockTx.wallet.upsert.mockResolvedValue({ balance: D(500) });
      mockTx.transaction.create.mockResolvedValue({ id: 'tx-1' });
      mockTx.idempotencyRecord.create.mockResolvedValue({});

      const result = await service.topup(dto);

      expect(result).toEqual({ balance: D(500), transactionId: 'tx-1' });
      expect(mockTx.wallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { balance: { increment: D('500') } },
        }),
      );
    });

    it('returns cached result on duplicate idempotencyKey', async () => {
      const cached = { balance: '500', transactionId: 'tx-1' };
      mockTx.idempotencyRecord.findUnique.mockResolvedValue({
        operationType: 'TOPUP',
        responseBody: cached,
      });

      const result = await service.topup(dto);

      expect(result).toEqual(cached);
      expect(mockTx.wallet.upsert).not.toHaveBeenCalled();
    });

    it('throws IDEMPOTENCY_CONFLICT when key was used for a different operation', async () => {
      mockTx.idempotencyRecord.findUnique.mockResolvedValue({
        operationType: 'CHARGE',
        responseBody: {},
      });

      await expect(service.topup(dto)).rejects.toThrow(
        IdempotencyConflictException,
      );
    });
  });

  // ─── charge ───────────────────────────────────────────────────────────────

  describe('charge', () => {
    const dto = {
      userId: 'u1',
      amount: '200',
      currency: 'RUB',
      idempotencyKey: 'key-2',
      reason: 'purchase',
    };

    beforeEach(() => {
      mockTx.$executeRaw.mockResolvedValue(undefined);
    });

    it('deducts balance and returns result', async () => {
      mockTx.idempotencyRecord.findUnique.mockResolvedValue(null);
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ balance: D(1000) }]) // wallet FOR UPDATE
        .mockResolvedValueOnce([{ total: D(0) }]); // daily_usage FOR UPDATE
      mockTx.wallet.update.mockResolvedValue({ balance: D(800) });
      mockTx.transaction.create.mockResolvedValue({ id: 'tx-2' });
      mockTx.idempotencyRecord.create.mockResolvedValue({});

      const result = await service.charge(dto);

      expect(result).toEqual({ balance: D(800), transactionId: 'tx-2' });
      expect(mockTx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: D('200') } } }),
      );
    });

    it('throws INSUFFICIENT_FUNDS when balance < amount', async () => {
      mockTx.idempotencyRecord.findUnique.mockResolvedValue(null);
      mockTx.$queryRaw.mockResolvedValueOnce([{ balance: D(100) }]);

      await expect(service.charge(dto)).rejects.toThrow(
        InsufficientFundsException,
      );
      expect(mockTx.wallet.update).not.toHaveBeenCalled();
    });

    it('throws INSUFFICIENT_FUNDS when wallet does not exist', async () => {
      mockTx.idempotencyRecord.findUnique.mockResolvedValue(null);
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.charge(dto)).rejects.toThrow(
        InsufficientFundsException,
      );
    });

    it('throws LIMIT_EXCEEDED when daily limit would be exceeded', async () => {
      mockTx.idempotencyRecord.findUnique.mockResolvedValue(null);
      mockTx.$queryRaw
        .mockResolvedValueOnce([{ balance: D(50000) }]) // wallet
        .mockResolvedValueOnce([{ total: D(9900) }]); // daily_usage

      await expect(service.charge({ ...dto, amount: '200' })).rejects.toThrow(
        LimitExceededException,
      );
    });

    it('returns cached result on duplicate idempotencyKey', async () => {
      const cached = { balance: '800', transactionId: 'tx-2' };
      mockTx.idempotencyRecord.findUnique.mockResolvedValue({
        operationType: 'CHARGE',
        responseBody: cached,
      });

      const result = await service.charge(dto);

      expect(result).toEqual(cached);
      expect(mockTx.$queryRaw).not.toHaveBeenCalled();
    });

    it('throws IDEMPOTENCY_CONFLICT when key was used for a different operation', async () => {
      mockTx.idempotencyRecord.findUnique.mockResolvedValue({
        operationType: 'TOPUP',
        responseBody: {},
      });

      await expect(service.charge(dto)).rejects.toThrow(
        IdempotencyConflictException,
      );
    });
  });

  // ─── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns balances and last N transactions', async () => {
      mockPrisma.wallet.findMany.mockResolvedValue([
        { currency: 'RUB', balance: D(800) },
      ]);
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-2',
          type: 'CHARGE',
          amount: D(200),
          currency: 'RUB',
          reason: 'purchase',
          createdAt: new Date(),
        },
      ]);

      const result = await service.getBalance({ userId: 'u1', limit: 10 });

      expect(result.balances).toEqual([{ currency: 'RUB', balance: D(800) }]);
      expect(result.transactions).toHaveLength(1);
    });

    it('fetches wallets and transactions in parallel', async () => {
      mockPrisma.wallet.findMany.mockResolvedValue([]);
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      await service.getBalance({ userId: 'u1', limit: 10 });

      // Both should have been called (Promise.all fires both)
      expect(mockPrisma.wallet.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
