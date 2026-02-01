import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    this.logger.debug(`🔍 Finding user by email: ${email}`);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (user) {
      this.logger.debug(`✅ User found: ${user.id}`);
    } else {
      this.logger.debug(`❌ User not found: ${email}`);
    }
    return user;
  }

  /**
   * Get all users in the organization (team members)
   */
  async getTeamMembers(organizationId: string) {
    this.logger.debug(`👥 Getting team members for org: ${organizationId}`);
    const users = await this.prisma.user.findMany({
      where: {
        organizationId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    this.logger.debug(`✅ Found ${users.length} team members`);
    return users;
  }

  /**
   * Get user by ID within organization (for validation)
   */
  async getUserById(userId: string, organizationId: string) {
    return this.prisma.user.findFirst({
      where: {
        id: userId,
        organizationId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });
  }

  /**
   * Create invitation for a new team member
   */
  async createInvitation(
    organizationId: string,
    invitedBy: string,
    email: string,
    role: string = 'user',
  ) {
    this.logger.log(`💌 Creating invitation for ${email} to org ${organizationId}`);
    this.logger.debug(`🔍 Parameters: organizationId=${organizationId}, invitedBy=${invitedBy}, email=${email}, role=${role}`);

    // Check if user already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email,
        organizationId,
      },
    });

    if (existingUser) {
      throw new Error('User with this email already exists in the organization');
    }

    // Check if there's a pending invitation
    const existingInvite = await this.prisma.invitation.findFirst({
      where: {
        email,
        organizationId,
        status: 'pending',
      },
    });

    if (existingInvite) {
      throw new Error('An invitation has already been sent to this email');
    }

    // Generate random token
    const token = require('crypto').randomBytes(32).toString('hex');

    // Create invitation (expires in 7 days)
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId,
        email,
        token,
        role,
        invitedBy,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    this.logger.log(`✅ Invitation created: ${invitation.id}`);

    return invitation;
  }

  /**
   * Get all pending invitations for organization
   */
  async getInvitations(organizationId: string) {
    return this.prisma.invitation.findMany({
      where: {
        organizationId,
        status: 'pending',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Revoke/cancel invitation
   */
  async revokeInvitation(invitationId: string, organizationId: string) {
    this.logger.log(`❌ Revoking invitation: ${invitationId}`);

    const invitation = await this.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        organizationId,
      },
    });

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new Error('Invitation is not pending');
    }

    return this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'revoked' },
    });
  }

  /**
   * Get invitation by token
   */
  async getInvitationByToken(token: string) {
    return this.prisma.invitation.findFirst({
      where: {
        token,
        status: 'pending',
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }
}
