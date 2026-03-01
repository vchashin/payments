import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BalanceQueryDto {
  @ApiProperty({ description: 'User ID', example: 'user-123' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Filter by currency code (ISO 4217)',
    example: 'USD',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency?: string;

  @ApiProperty({
    description: 'Maximum count of transactions to return',
    example: 10,
    required: false,
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
