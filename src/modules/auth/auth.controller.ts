import {
  Body,
  Controller,
  Post,
  Get,
  Query,
  Param,
  Logger,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body()
    body: {
      email: string;
      password: string;
      name: string;
      organizationName: string;
    },
  ) {
    this.logger.log(`Registration attempt for email: ${body.email}`);

    try {
      const result = await this.authService.register(body);
      this.logger.log(`Registration successful for user: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Registration failed for email: ${body.email}`, error.message);
      throw error;
    }
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    this.logger.log(`Login attempt for email: ${body.email}`);
    try {
      const user = await this.authService.validateUser(body.email, body.password);
      const result = await this.authService.login(user);
      this.logger.log(`Login successful for user: ${user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Login failed for email: ${body.email}`, error.message);
      throw error;
    }
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getCurrentUser(@Req() req: any) {
    const userId = req.user.userId || req.user.sub;
    const organizationId = req.user.organizationId;

    this.logger.log(`Getting current user: ${userId}`);

    try {
      const user = await this.authService.getUserById(userId, organizationId);

      if (!user) {
        throw new Error('User not found');
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        platformRole: user.platformRole || 'NONE',
        organizationId: user.organizationId,
      };
    } catch (error) {
      this.logger.error('Failed to get current user:', error.message);
      throw error;
    }
  }

  @Get('oauth/url')
  @UseGuards(AuthGuard('jwt'))
  async getOAuthUrl(@Req() req: any) {
    const organizationId = req.user.organizationId;
    const userId = req.user.userId;

    if (!organizationId) {
      this.logger.error(`No organizationId found for user: ${userId}`);
      throw new Error('User has no organization');
    }

    const state = `${organizationId}:${Date.now()}`;
    const redirectUri = this.getOAuthRedirectUriFromRequest(req);
    const url = this.authService.buildOAuthUrl(state, redirectUri);

    this.logger.log(`OAuth URL generated for user: ${userId}, org: ${organizationId}`);
    return { url, state, organizationId };
  }

  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    this.logger.log(`OAuth callback received with state: ${state}`);
    try {
      const redirectUri = this.getOAuthRedirectUriFromRequest(req);
      await this.authService.handleOAuthCallback(code, state, redirectUri);
      this.logger.log('OAuth callback processed successfully');

      const frontendPath = this.getFrontendConnectionsPath();
      res.redirect(`${frontendPath}?oauth=success`);
    } catch (error) {
      this.logger.error('OAuth callback failed:', error.message);

      const frontendPath = this.getFrontendConnectionsPath();
      res.redirect(
        `${frontendPath}?oauth=error&message=${encodeURIComponent(error.message)}`,
      );
    }
  }

  /**
   * GET /api/auth/invitation/:token
   * Get invitation details (for preview page)
   */
  @Get('invitation/:token')
  async getInvitation(@Param('token') token: string) {
    this.logger.log('Getting invitation details for token');
    try {
      const invitation = await this.authService.getInvitation(token);
      this.logger.log(`Invitation found for email: ${invitation.email}`);
      return invitation;
    } catch (error) {
      this.logger.error('Failed to get invitation:', error.message);
      throw error;
    }
  }

  /**
   * POST /api/auth/accept-invite
   * Accept invitation and create account
   */
  @Post('accept-invite')
  async acceptInvite(
    @Body() body: { token: string; name: string; password: string },
  ) {
    this.logger.log('Accepting invitation');
    try {
      const result = await this.authService.acceptInvitation(body);
      this.logger.log(`Invitation accepted, user created: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to accept invitation:', error.message);
      throw error;
    }
  }

  private getOAuthRedirectUriFromRequest(req: any): string {
    const forwardedProto = req?.headers?.['x-forwarded-proto'];
    const forwardedHost = req?.headers?.['x-forwarded-host'];
    const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req?.headers?.host;
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || req?.protocol || 'https';

    return `${proto}://${host}/api/auth/oauth/callback`;
  }

  private getFrontendConnectionsPath(): string {
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
    const hasLocalePrefix = /\/[a-z]{2}$/i.test(frontendUrl);

    if (hasLocalePrefix) {
      return `${frontendUrl}/dashboard/connections`;
    }

    return `${frontendUrl}/${defaultLocale}/dashboard/connections`;
  }
}
