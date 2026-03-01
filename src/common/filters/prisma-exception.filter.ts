import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '../../../generated/prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    this.logger.error(`Prisma error [${exception.code}]: ${exception.message}`);

    switch (exception.code) {
      case 'P2025':
        response.status(HttpStatus.NOT_FOUND).json({
          error: 'NOT_FOUND',
          message: 'Record not found',
        });
        break;
      default:
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          error: 'DATABASE_ERROR',
          message: 'An unexpected database error occurred',
        });
    }
  }
}
