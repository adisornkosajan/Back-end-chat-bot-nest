import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlanTier } from '@prisma/client';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  async createCheckout(@Req() req: any, @Body() body: { plan: PlanTier }) {
    return this.billingService.createCheckout(req.user.organizationId, body.plan);
  }

  @Get('invoices')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async listInvoices(@Req() req: any) {
    return this.billingService.listInvoices(req.user.organizationId);
  }

  @Post('webhook')
  async webhook(
    @Headers('x-billing-secret') secret: string,
    @Body()
    body: {
      event: string;
      providerRef?: string;
      orgId?: string;
      plan?: PlanTier;
      days?: number;
    },
  ) {
    this.billingService.verifyWebhookSecret(secret);
    return this.billingService.handleWebhook(body);
  }
}

