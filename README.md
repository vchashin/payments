# Wallet Service

Микросервис кошелька с поддержкой пополнения, списания, идемпотентности и дневных лимитов.

## Стек

| Слой | Технология | Версия |
|---|---|---|
| Runtime | Node.js | ≥ 20 |
| Framework | NestJS | 11 |
| ORM | Prisma | 7 |
| База данных | PostgreSQL | 17 |
| Валидация | class-validator / class-transformer | — |
| Документация API | Swagger (OpenAPI) | — |
| Тесты | Jest | — |

---

## Запуск

### 1. Зависимости

```bash
npm install
```

### 2. База данных

Запустите PostgreSQL через Docker:

```bash
docker compose up -d
```

Или укажите собственный инстанс — создайте `.env` из примера:

```bash
cp .env.example .env
# Отредактируйте DATABASE_URL и DAILY_CHARGE_LIMIT
```

### 3. Миграции

```bash
npx prisma migrate deploy
```

### 4. Запуск

```bash
# Режим разработки (hot reload)
npm run start:dev

# Production
npm run build && npm run start:prod
```

Сервис: `http://localhost:3000`  
Swagger UI: `http://localhost:3000/api`

---

## API

### POST /topup — Пополнение

```json
{
  "userId": "user-123",
  "amount": "1000.00",
  "currency": "RUB",
  "idempotencyKey": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

Ответ `201`:
```json
{ "balance": "1000.000000000000000000", "transactionId": "uuid" }
```

---

### POST /charge — Списание

```json
{
  "userId": "user-123",
  "amount": "200.00",
  "currency": "RUB",
  "idempotencyKey": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "reason": "Subscription payment"
}
```

Ответ `201`:
```json
{ "balance": "800.000000000000000000", "transactionId": "uuid" }
```

Ошибки:

| Статус | Код | Причина |
|---|---|---|
| 400 | `INSUFFICIENT_FUNDS` | Недостаточно средств |
| 400 | `LIMIT_EXCEEDED` | Превышен дневной лимит списаний |
| 409 | `IDEMPOTENCY_CONFLICT` | Ключ уже использован для другой операции |

---

### GET /balance — Баланс и история

```
GET /balance?userId=user-123&currency=RUB&limit=10
```

Параметры: `userId` (обязательный), `currency` (опциональный), `limit` (1–100, по умолчанию 10).

Ответ `200`:
```json
{
  "balances": [
    { "currency": "RUB", "balance": "800.000000000000000000" }
  ],
  "transactions": [
    {
      "id": "uuid",
      "type": "CHARGE",
      "amount": "200.000000000000000000",
      "currency": "RUB",
      "reason": "Subscription payment",
      "createdAt": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

---

## Тесты

```bash
npm run test          # unit-тесты (без БД)
npm run test:e2e      # e2e-тесты (нужна PostgreSQL из .env)
```

---

## Архитектурные решения

### Идемпотентность

Перед любой бизнес-логикой делается поиск по `idempotencyKey` в таблице `idempotency_records`. Если запись найдена — возвращается сохранённый ответ без каких-либо изменений в БД. Если нет — операция выполняется, ответ сохраняется **в той же транзакции**. Атомарность гарантирует, что частично выполненная операция никогда не сохранит ответ.

Ключ является **глобально уникальным** (не per-endpoint): одним ключом нельзя использовать сначала для `topup`, а потом для `charge`. Это выявляет ошибки на стороне клиента — он получит `409 IDEMPOTENCY_CONFLICT` вместо молчаливого возврата неправильных данных. Поле `operationType` хранится рядом с ключом и проверяется при каждом обращении.

**Конкурентные дубли:** два одинаковых запроса, пришедших одновременно, оба пройдут `findUnique → null`. Один закоммитится и создаст запись. Второй получит ошибку `P2002` (unique constraint) — транзакция откатится, сервис поймает исключение и вернёт кэшированный ответ победившей транзакции.

### Гонки при списании

В `/charge` используется **пессимистичная блокировка** на уровне строки:

```sql
SELECT balance FROM wallets
WHERE "userId" = $1 AND currency = $2
FOR UPDATE
```

Строка кошелька блокируется до конца транзакции. Параллельный запрос ждёт снятия блокировки и после разблокировки видит уже списанный баланс. Это исключает ситуацию, когда два `/charge` одновременно видят достаточный остаток и оба успешно списывают.

### Дневной лимит без race condition

Наивная реализация — `SUM` по таблице транзакций за текущий день — не защищена от гонок: два конкурентных запроса прочитают одинаковую сумму и оба пройдут проверку, суммарно превысив лимит.

Решение — отдельная таблица `daily_usage` с одной строкой на `(userId, currency, date)`. Строка блокируется через `SELECT FOR UPDATE` **внутри той же транзакции**, что и блокировка кошелька:

```
T1: wallet FOR UPDATE → daily_usage FOR UPDATE → проверка → update
T2: wallet FOR UPDATE → ждёт T1 → после разблокировки читает обновлённый счётчик
```

`SELECT FOR UPDATE` в PostgreSQL всегда читает **последнюю закоммиченную версию строки** (вне зависимости от уровня изоляции), поэтому T2 видит реальную накопленную сумму после T1.

Счётчик сбрасывается автоматически: каждый день создаётся новая строка с `total = 0`. Старые строки можно удалять по `createdAt`-индексу фоновой задачей.

### Точность финансовых значений

Суммы хранятся как `DECIMAL(36, 18)` в PostgreSQL, обрабатываются через `Prisma.Decimal` (на базе `decimal.js`) — без потерь точности на операциях с плавающей точкой. На входе принимается `string` (`"9.99"`), а не `number` (`9.99`). Это исключает JavaScript float-неточности ещё до попадания значения в сервис: клиент не может случайно отправить `0.30000000000000004`.

### Структура кода

```
src/
  common/
    filters/          # PrismaExceptionFilter — маппинг Prisma-ошибок в HTTP
    validators/       # IsPositiveDecimalString — кастомный декоратор для amount
  prisma/             # PrismaService (lifecycle hooks, connection check)
  wallet/
    dto/              # TopupDto, ChargeDto, BalanceQueryDto (class-validator)
    exceptions/       # Typed HTTP exceptions (INSUFFICIENT_FUNDS и др.)
    wallet.controller # Маршруты, Swagger-аннотации
    wallet.service    # Вся бизнес-логика и транзакции
    wallet.module
prisma/
  schema.prisma       # Модели: Wallet, Transaction, IdempotencyRecord, DailyUsage
  migrations/
```

Вся бизнес-логика намеренно сосредоточена в `WalletService`. Для тестового задания это оправдано: упрощает чтение кода и избегает избыточных абстракций (Repository, Use Cases). В production при росте функциональности имеет смысл выделить слой репозиториев.

### Схема БД

```
wallets             — (userId, currency) → balance: Decimal
transactions        — лог операций; индекс по (userId, currency, type, createdAt)
idempotency_records — (key) → operationType, responseBody; индекс по createdAt для TTL-очистки
daily_usage         — (userId, currency, date) → total: Decimal; счётчик дневных списаний
```
