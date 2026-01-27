import { Injectable, UnauthorizedException, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async register(data: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
  }) {
    this.logger.debug(`Registering new user: ${data.email} with org: ${data.organizationName}`);

    // Validate input
    if (!data.email || !data.password || !data.name || !data.organizationName) {
      throw new BadRequestException('All fields are required');
    }

    if (data.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      throw new BadRequestException('Invalid email format');
    }

    // Check if user already exists
    const existingUser = await this.usersService.findByEmail(data.email);
    if (existingUser) {
      this.logger.warn(`⚠️ Email already registered: ${data.email}`);
      throw new ConflictException('Email already registered');
    }

    // Check if organization name already exists
    // Note: MySQL comparison is case-insensitive by default for VARCHAR columns
    const existingOrg = await this.prisma.organization.findFirst({
      where: {
        name: data.organizationName,
      },
    });

    if (existingOrg) {
      this.logger.warn(`⚠️ Organization name already exists: ${data.organizationName}`);
      throw new ConflictException('Organization name already exists. Please choose a different name.');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Create organization and user in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create organization
      const organization = await tx.organization.create({
        data: {
          name: data.organizationName,
        },
      });

      // Create user
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          name: data.name,
          role: 'ADMIN',
          organizationId: organization.id,
        },
      });

      return { user, organization };
    });

    this.logger.log(`✅ User registered: ${result.user.id}, Org: ${result.organization.id}`);
    this.logger.debug(`📋 User Details - Email: ${result.user.email}, OrgId: ${result.user.organizationId}`);

    // Generate JWT token
    const payload = {
      sub: result.user.id,
      organizationId: result.user.organizationId,
      role: result.user.role,
    };

    this.logger.debug(`🎟️ JWT Payload: userId=${payload.sub}, orgId=${payload.organizationId}, role=${payload.role}`);

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        organizationId: result.user.organizationId,
      },
      organization: {
        id: result.organization.id,
        name: result.organization.name,
      },
    };
  }

  async validateUser(email: string, password: string) {
    this.logger.debug(`Validating user: ${email}`);
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      this.logger.warn(`User not found or no password: ${email}`);
      throw new UnauthorizedException();
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      this.logger.warn(`Invalid password for user: ${email}`);
      throw new UnauthorizedException();
    }

    this.logger.debug(`User validated successfully: ${email}`);
    return user;
  }

  async login(user: any) {
    this.logger.debug(`🔐 Creating JWT for user: ${user.id}, org: ${user.organizationId}`);
    
    const payload = {
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
    };

    this.logger.debug(`🎟️ JWT Payload: userId=${payload.sub}, orgId=${payload.organizationId}, role=${payload.role}`);

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  buildOAuthUrl(state: string) {
    const appId = this.configService.get('oauth.meta.appId');
    const redirectUri = this.configService.get('oauth.meta.redirectUri');
    const oauthUrl = this.configService.get('oauth.meta.oauthUrl');
    const scopes = this.configService.get('oauth.meta.scopes');

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes.join(','),
    });

    this.logger.debug(`🔗 Generated OAuth URL with state: ${state}`);
    return `${oauthUrl}?${params.toString()}`;
  }

  async handleOAuthCallback(code: string, state: string) {
    try {
      this.logger.debug(`🔄 Handling OAuth callback with code and state: ${state}`);

      // Exchange code for access token
      const tokenUrl = this.configService.get('oauth.meta.tokenUrl');
      const appId = this.configService.get('oauth.meta.appId');
      const appSecret = this.configService.get('oauth.meta.appSecret');
      const redirectUri = this.configService.get('oauth.meta.redirectUri');

      const tokenResponse = await axios.get(tokenUrl, {
        params: {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        },
      });

      const { access_token } = tokenResponse.data;
      this.logger.debug(`✅ Access token obtained`);

      // Exchange for long-lived token (60 days)
      const longLivedTokenResponse = await axios.get(
        'https://graph.facebook.com/v21.0/oauth/access_token',
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: access_token,
          },
        },
      );

      const longLivedToken = longLivedTokenResponse.data.access_token;
      this.logger.debug(`✅ Long-lived token obtained`);

      // Get Pages/Instagram accounts
      const accountsResponse = await axios.get(
        'https://graph.facebook.com/v21.0/me/accounts',
        {
          params: {
            access_token: longLivedToken,
            fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
          },
        },
      );

      const pages = accountsResponse.data.data || [];
      this.logger.debug(`📄 Found ${pages.length} pages/accounts`);

      // Parse state to get organizationId (format: "orgId:timestamp" หรือแค่ "orgId")
      const organizationId = state.split(':')[0];

      // 🔒 CRITICAL: Validate organizationId exists
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        this.logger.error(`❌ Invalid organizationId in state: ${organizationId}`);
        throw new UnauthorizedException('Invalid organization ID');
      }

      this.logger.log(`✅ Connecting platforms to org: ${organization.name} (${organizationId})`);

      // Save platforms to database
      const savedPlatforms: any[] = [];
      for (const page of pages) {
        // Save Facebook Page
        const fbPlatform = await this.prisma.platform.upsert({
          where: {
            organizationId_type_pageId: {
              organizationId,
              type: 'facebook',
              pageId: page.id,
            },
          },
          update: {
            accessToken: page.access_token,
            credentials: {
              pageId: page.id,
              pageName: page.name,
            },
          },
          create: {
            organizationId,
            type: 'facebook',
            pageId: page.id,
            accessToken: page.access_token,
            credentials: {
              pageId: page.id,
              pageName: page.name,
            },
          },
        });
        savedPlatforms.push(fbPlatform);

        // Save Instagram if available
        if (page.instagram_business_account) {
          const igAccount = page.instagram_business_account;
          const igPlatform = await this.prisma.platform.upsert({
            where: {
              organizationId_type_pageId: {
                organizationId,
                type: 'instagram',
                pageId: igAccount.id,
              },
            },
            update: {
              accessToken: page.access_token, // ใช้ page token เหมือนกัน
              credentials: {
                instagramAccountId: igAccount.id,
                username: igAccount.username,
                name: igAccount.name,
                profilePicture: igAccount.profile_picture_url,
              },
            },
            create: {
              organizationId,
              type: 'instagram',
              pageId: igAccount.id,
              accessToken: page.access_token,
              credentials: {
                instagramAccountId: igAccount.id,
                username: igAccount.username,
                name: igAccount.name,
                profilePicture: igAccount.profile_picture_url,
              },
            },
          });
          savedPlatforms.push(igPlatform);
        }
      }

      this.logger.debug(
        `✅ Saved ${savedPlatforms.length} platforms to database`,
      );

      return {
        success: true,
        platforms: savedPlatforms,
      };
    } catch (error) {
      this.logger.error('❌ OAuth callback error:', error.response?.data || error.message);
      throw new UnauthorizedException('Failed to process OAuth callback');
    }
  }
}
