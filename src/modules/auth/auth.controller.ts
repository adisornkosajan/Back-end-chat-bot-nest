import { Body, Controller, Post, Get, Query, Logger, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() body: {
      email: string;
      password: string;
      name: string;
      organizationName: string;
    },
  ) {
    this.logger.log(`📝 Registration attempt for email: ${body.email}`);
    try {
      const result = await this.authService.register(body);
      this.logger.log(`✅ Registration successful for user: ${result.user.id}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Registration failed for email: ${body.email}`, error.message);
      throw error;
    }
  }

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
    const userId = req.user.userId;
    
    if (!organizationId) {
      this.logger.error(`❌ No organizationId found for user: ${userId}`);
      throw new Error('User has no organization');
    }
    
    const state = `${organizationId}:${Date.now()}`;
    const url = this.authService.buildOAuthUrl(state);
    
    this.logger.log(`🔗 OAuth URL generated for user: ${userId}, org: ${organizationId}`);
    return { url, state, organizationId };
  }

  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    this.logger.log(`📥 OAuth callback received with state: ${state}`);
    try {
      const result = await this.authService.handleOAuthCallback(code, state);
      this.logger.log(`✅ OAuth callback processed successfully`);
      
      // Redirect กลับไปที่ frontend connections page
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/dashboard/connections?oauth=success`);
    } catch (error) {
      this.logger.error(`❌ OAuth callback failed:`, error.message);
      
      // Redirect กลับไปพร้อม error message
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/dashboard/connections?oauth=error&message=${encodeURIComponent(error.message)}`);
    }
  }
}
