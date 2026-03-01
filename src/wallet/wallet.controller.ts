import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { BalanceQueryDto } from './dto/balance-query.dto';
import { ChargeDto } from './dto/charge.dto';
import { TopupDto } from './dto/topup.dto';

@ApiTags('Wallet')
@Controller()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @ApiOperation({
    summary: 'Get wallet balance',
    description:
      'Returns balance entries for a user, optionally filtered by currency.',
  })
  @Get('balance')
  getBalance(@Query() dto: BalanceQueryDto) {
    return this.walletService.getBalance(dto);
  }

  @ApiOperation({
    summary: 'Charge wallet',
    description:
      'Deducts the specified amount from the user wallet. Idempotent by idempotencyKey.',
  })
  @Post('charge')
  charge(@Body() dto: ChargeDto) {
    return this.walletService.charge(dto);
  }

  @ApiOperation({
    summary: 'Top up wallet',
    description:
      'Credits the specified amount to the user wallet. Idempotent by idempotencyKey.',
  })
  @Post('topup')
  topup(@Body() dto: TopupDto) {
    return this.walletService.topup(dto);
  }
}
