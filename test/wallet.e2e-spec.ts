import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';

/**
 * E2E tests require a running PostgreSQL instance.
 * Set DATABASE_URL in .env before running.
 * Run: npm run test:e2e
 */
describe('Wallet (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new PrismaExceptionFilter());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    await prisma.idempotencyRecord.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.$executeRaw`DELETE FROM daily_usage`;
    await prisma.wallet.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── topup ──────────────────────────────────────────────────────────────

  describe('POST /topup', () => {
    it('credits balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/topup')
        .send({
          userId: 'u1',
          amount: '1000',
          currency: 'RUB',
          idempotencyKey: 'k1',
        })
        .expect(201);

      expect(res.body.transactionId).toBeDefined();
    });

    it('is idempotent — second call returns same result without double credit', async () => {
      const payload = {
        userId: 'u1',
        amount: '1000',
        currency: 'RUB',
        idempotencyKey: 'k-idem',
      };
      const first = await request(app.getHttpServer())
        .post('/topup')
        .send(payload)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/topup')
        .send(payload)
        .expect(201);

      expect(first.body).toEqual(second.body);

      const balanceRes = await request(app.getHttpServer())
        .get('/balance')
        .query({ userId: 'u1', currency: 'RUB' });
      // Only one topup of 1000 should have been applied
      expect(Number(balanceRes.body.balances[0].balance)).toBe(1000);
    });

    it('rejects amount <= 0', () =>
      request(app.getHttpServer())
        .post('/topup')
        .send({
          userId: 'u1',
          amount: '0',
          currency: 'RUB',
          idempotencyKey: 'k2',
        })
        .expect(400));

    it('rejects non-string amount', () =>
      request(app.getHttpServer())
        .post('/topup')
        .send({
          userId: 'u1',
          amount: 100,
          currency: 'RUB',
          idempotencyKey: 'k3',
        })
        .expect(400));

    it('returns 409 when idempotency key was used for a different operation', async () => {
      // First use the key for a topup
      await request(app.getHttpServer())
        .post('/topup')
        .send({
          userId: 'u1',
          amount: '100',
          currency: 'RUB',
          idempotencyKey: 'shared-key',
        })
        .expect(201);

      // Then try to use the same key for a charge
      const res = await request(app.getHttpServer())
        .post('/charge')
        .send({
          userId: 'u1',
          amount: '50',
          currency: 'RUB',
          idempotencyKey: 'shared-key',
          reason: 'test',
        })
        .expect(409);

      expect(res.body.error).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // ─── charge ─────────────────────────────────────────────────────────────

  describe('POST /charge', () => {
    beforeEach(async () => {
      await request(app.getHttpServer()).post('/topup').send({
        userId: 'u1',
        amount: '5000',
        currency: 'RUB',
        idempotencyKey: 'setup',
      });
    });

    it('deducts balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/charge')
        .send({
          userId: 'u1',
          amount: '200',
          currency: 'RUB',
          idempotencyKey: 'c1',
          reason: 'buy',
        })
        .expect(201);

      expect(Number(res.body.balance)).toBe(4800);
    });

    it('returns INSUFFICIENT_FUNDS when balance is too low', () =>
      request(app.getHttpServer())
        .post('/charge')
        .send({
          userId: 'u1',
          amount: '9999',
          currency: 'RUB',
          idempotencyKey: 'c2',
          reason: 'buy',
        })
        .expect(400)
        .expect((res) => expect(res.body.error).toBe('INSUFFICIENT_FUNDS')));

    it('returns LIMIT_EXCEEDED when daily limit is reached', async () => {
      await request(app.getHttpServer()).post('/topup').send({
        userId: 'u1',
        amount: '100000',
        currency: 'RUB',
        idempotencyKey: 'big-topup',
      });

      await request(app.getHttpServer()).post('/charge').send({
        userId: 'u1',
        amount: '9000',
        currency: 'RUB',
        idempotencyKey: 'c3',
        reason: 'buy',
      });

      const res = await request(app.getHttpServer())
        .post('/charge')
        .send({
          userId: 'u1',
          amount: '2000',
          currency: 'RUB',
          idempotencyKey: 'c4',
          reason: 'buy',
        })
        .expect(400);

      expect(res.body.error).toBe('LIMIT_EXCEEDED');
    });

    it('is idempotent — second call returns same result without double deduct', async () => {
      const payload = {
        userId: 'u1',
        amount: '100',
        currency: 'RUB',
        idempotencyKey: 'c-idem',
        reason: 'buy',
      };
      const first = await request(app.getHttpServer())
        .post('/charge')
        .send(payload)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/charge')
        .send(payload)
        .expect(201);

      expect(first.body).toEqual(second.body);

      const balanceRes = await request(app.getHttpServer())
        .get('/balance')
        .query({ userId: 'u1', currency: 'RUB' });
      expect(Number(balanceRes.body.balances[0].balance)).toBe(4900);
    });
  });

  // ─── balance ────────────────────────────────────────────────────────────

  describe('GET /balance', () => {
    it('returns balance and last N transactions', async () => {
      await request(app.getHttpServer()).post('/topup').send({
        userId: 'u1',
        amount: '1000',
        currency: 'RUB',
        idempotencyKey: 't1',
      });
      await request(app.getHttpServer()).post('/charge').send({
        userId: 'u1',
        amount: '300',
        currency: 'RUB',
        idempotencyKey: 't2',
        reason: 'test',
      });

      const res = await request(app.getHttpServer())
        .get('/balance')
        .query({ userId: 'u1', currency: 'RUB', limit: 5 })
        .expect(200);

      expect(Number(res.body.balances[0].balance)).toBe(700);
      expect(res.body.transactions).toHaveLength(2);
      expect(res.body.transactions[0].type).toBe('CHARGE');
    });

    it('rejects limit > 100', () =>
      request(app.getHttpServer())
        .get('/balance')
        .query({ userId: 'u1', limit: 101 })
        .expect(400));
  });
});
