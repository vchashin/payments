import { BadRequestException, ConflictException } from '@nestjs/common';

export class InsufficientFundsException extends BadRequestException {
  constructor() {
    super({ error: 'INSUFFICIENT_FUNDS', message: 'Not enough balance' });
  }
}

export class LimitExceededException extends BadRequestException {
  constructor() {
    super({
      error: 'LIMIT_EXCEEDED',
      message: 'Daily charge limit exceeded',
    });
  }
}

export class IdempotencyConflictException extends ConflictException {
  constructor() {
    super({
      error: 'IDEMPOTENCY_CONFLICT',
      message:
        'The idempotency key was already used for a different operation type',
    });
  }
}
