import { Controller, Get, Post, Param, UseGuards, Req, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
@UseGuards(AuthGuard('jwt'))
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(private readonly integrationsService: IntegrationsService) {}

  // Facebook Pages
  @Get('facebook/pages')
  async getFacebookPages(@Req() req: any) {
    this.logger.log(`📘 Getting Facebook pages for org: ${req.user.organizationId}`);
    return this.integrationsService.getFacebookPages(req.user.organizationId);
  }

  @Post('facebook/:pageId/connect')
  async connectFacebookPage(@Req() req: any, @Param('pageId') pageId: string) {
    this.logger.log(`🔌 Connecting Facebook page: ${pageId}`);
    return this.integrationsService.connectFacebookPage(
      req.user.organizationId,
      pageId,
    );
  }

  @Post('facebook/:pageId/disconnect')
  async disconnectFacebookPage(@Req() req: any, @Param('pageId') pageId: string) {
    this.logger.log(`🔌 Disconnecting Facebook page: ${pageId}`);
    return this.integrationsService.disconnectFacebookPage(
      req.user.organizationId,
      pageId,
    );
  }

  // Instagram
  @Get('instagram/accounts')
  async getInstagramAccounts(@Req() req: any) {
    this.logger.log(`📷 Getting Instagram accounts for org: ${req.user.organizationId}`);
    return this.integrationsService.getInstagramAccounts(req.user.organizationId);
  }

  @Post('instagram/:accountId/connect')
  async connectInstagramAccount(@Req() req: any, @Param('accountId') accountId: string) {
    this.logger.log(`🔌 Connecting Instagram account: ${accountId}`);
    return this.integrationsService.connectInstagramAccount(
      req.user.organizationId,
      accountId,
    );
  }

  @Post('instagram/:accountId/disconnect')
  async disconnectInstagramAccount(@Req() req: any, @Param('accountId') accountId: string) {
    this.logger.log(`🔌 Disconnecting Instagram account: ${accountId}`);
    return this.integrationsService.disconnectInstagramAccount(
      req.user.organizationId,
      accountId,
    );
  }

  // WhatsApp
  @Get('whatsapp/numbers')
  async getWhatsAppNumbers(@Req() req: any) {
    this.logger.log(`💬 Getting WhatsApp numbers for org: ${req.user.organizationId}`);
    return this.integrationsService.getWhatsAppNumbers(req.user.organizationId);
  }

  @Post('whatsapp/:numberId/connect')
  async connectWhatsAppNumber(@Req() req: any, @Param('numberId') numberId: string) {
    this.logger.log(`🔌 Connecting WhatsApp number: ${numberId}`);
    return this.integrationsService.connectWhatsAppNumber(
      req.user.organizationId,
      numberId,
    );
  }

  @Post('whatsapp/:numberId/disconnect')
  async disconnectWhatsAppNumber(@Req() req: any, @Param('numberId') numberId: string) {
    this.logger.log(`🔌 Disconnecting WhatsApp number: ${numberId}`);
    return this.integrationsService.disconnectWhatsAppNumber(
      req.user.organizationId,
      numberId,
    );
  }
}
