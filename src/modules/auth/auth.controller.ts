import { Body, Controller, Post, Get, Query, Logger, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
  ) {
    this.logger.log(`🔐 Login attempt for email: ${body.email}`);
    try {
      const user = await this.authService.validateUser(
        body.email,
        body.password,
      );
      const result = await this.authService.login(user);
      this.logger.log(`✅ Login successful for user: ${user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Login failed for email: ${body.email}`, error.message);
      throw error;
    }
  }

  @Get('oauth/url')
  @UseGuards(AuthGuard('jwt'))
  async getOAuthUrl(@Req() req: any) {
    const organizationId = req.user.organizationId;
    const state = `${organizationId}:${Date.now()}`;
    const url = this.authService.buildOAuthUrl(state);
    
    this.logger.log(`🔗 OAuth URL generated for org: ${organizationId}`);
    return { url, state };
  }

  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    this.logger.log(`📥 OAuth callback received with state: ${state}`);
    try {
      const result = await this.authService.handleOAuthCallback(code, state);
      this.logger.log(`✅ OAuth callback processed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`❌ OAuth callback failed:`, error.message);
      throw error;
    }
  }
}
