import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsPositiveDecimalString } from '../../common/validators/is-positive-decimal.validator';

export class TopupDto {
  @ApiProperty({ description: 'User ID', example: 'user-123' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description:
      'Amount to top up as a decimal string (up to 18 decimal places)',
    example: '100.00',
  })
  @IsString()
  @IsPositiveDecimalString()
  amount: string;

  @ApiProperty({ description: 'Currency code (ISO 4217)', example: 'USD' })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({
    description: 'Unique key to ensure idempotent requests',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}
