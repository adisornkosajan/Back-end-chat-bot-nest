import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlanTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LicensingService } from '../licensing/licensing.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licensingService: LicensingService,
  ) {}

  private getAmountForPlan(plan: PlanTier): number {
    if (plan === PlanTier.BASIC) return 199000;
    if (plan === PlanTier.PRO) return 499000;
    if (plan === PlanTier.ENTERPRISE) return 1999000;
    return 0;
  }

  async createCheckout(organizationId: string, plan: PlanTier) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const amountCents = this.getAmountForPlan(plan);
    const providerRef = `chk_${Date.now()}`;

    const invoice = await this.prisma.invoice.create({
      data: {
        organizationId,
        provider: 'manual',
        providerRef,
        amountCents,
        currency: 'THB',
        status: 'pending',
        periodStart: now,
        periodEnd,
      },
    });

    return {
      invoiceId: invoice.id,
      providerRef: invoice.providerRef,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      paymentUrl: `/billing/pay/${invoice.id}`,
    };
  }

  async listInvoices(organizationId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async handleWebhook(payload: {
    event: string;
    providerRef?: string;
    orgId?: string;
    plan?: PlanTier;
    days?: number;
  }) {
    if (payload.event === 'invoice.paid' && payload.providerRef) {
      const invoice = await this.prisma.invoice.findFirst({
        where: { providerRef: payload.providerRef },
      });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'paid', paidAt: new Date() },
      });

      if (payload.plan) {
        await this.licensingService.createLicense(invoice.organizationId, {
          plan: payload.plan,
        });
      } else {
        await this.licensingService.renewLicense(
          invoice.organizationId,
          payload.days ?? 30,
        );
      }

      return { ok: true };
    }

    if (payload.event === 'subscription.canceled' && payload.orgId) {
      await this.licensingService.suspendLicense(
        payload.orgId,
        'Canceled by billing provider',
      );
      return { ok: true };
    }

    return { ok: true, ignored: true };
  }

  verifyWebhookSecret(secretFromHeader?: string) {
    const expected = process.env.BILLING_WEBHOOK_SECRET;
    if (!expected) return true;
    if (secretFromHeader !== expected) {
      throw new ForbiddenException('Invalid billing webhook secret');
    }
    return true;
  }
}

