import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../common/decorators/roles.decorator';

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
        platformRole: true,
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

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    organizationId: string,
    data: { name?: string; email?: string },
  ) {
    this.logger.log(`📝 Updating profile for user: ${userId}`);

    // Check if email is being changed and if it's already taken
    if (data.email) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          email: data.email,
          organizationId,
          NOT: {
            id: userId,
          },
        },
      });

      if (existingUser) {
        throw new Error('Email is already in use by another user');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.email && { email: data.email }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    this.logger.log(`✅ Profile updated for user: ${userId}`);
    return updatedUser;
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    organizationId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    this.logger.log(`🔐 Changing password for user: ${userId}`);

    // Get user with password
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        organizationId,
      },
    });

    if (!user || !user.passwordHash) {
      throw new Error('User not found or invalid authentication method');
    }

    // Verify current password
    const bcrypt = require('bcrypt');
    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash: newPasswordHash,
      },
    });

    this.logger.log(`✅ Password changed successfully for user: ${userId}`);
    return { success: true, message: 'Password changed successfully' };
  }

  /**
   * Update user role (ADMIN only)
   */
  async updateUserRole(userId: string, newRole: UserRole, requestingUserId: string, organizationId: string) {
    // Check if target user exists and belongs to organization
    const targetUser = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Prevent user from changing their own role
    if (userId === requestingUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    // Check if organization has at least one admin
    if (targetUser.role === UserRole.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: { organizationId, role: UserRole.ADMIN },
      });

      if (adminCount <= 1) {
        throw new BadRequestException('Cannot change the only admin. Assign another admin first.');
      }
    }

    this.logger.log(`🔄 Updating user role: ${userId} to ${newRole}`);
    return this.prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Delete user (ADMIN only)
   */
  async deleteUser(userId: string, requestingUserId: string, organizationId: string) {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    if (userId === requestingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    // Check if organization has at least one admin
    if (targetUser.role === UserRole.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: { organizationId, role: UserRole.ADMIN },
      });

      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the only admin');
      }
    }

    this.logger.log(`🗑️ Deleting user: ${userId}`);
    await this.prisma.user.delete({
      where: { id: userId },
    });

    return { message: 'User deleted successfully' };
  }
}

