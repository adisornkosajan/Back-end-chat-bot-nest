import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /api/users/profile
   * Get current user profile
   */
  @Get('profile')
  async getProfile(@Req() req: any) {
    return this.usersService.getUserById(req.user.id, req.user.organizationId);
  }

  /**
   * PUT /api/users/profile
   * Update current user profile
   */
  @Put('profile')
  async updateProfile(
    @Req() req: any,
    @Body() body: { name?: string; email?: string },
  ) {
    return this.usersService.updateProfile(req.user.id, req.user.organizationId, body);
  }

  /**
   * POST /api/users/change-password
   * Change current user password
   */
  @Post('change-password')
  async changePassword(
    @Req() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.usersService.changePassword(
      req.user.id,
      req.user.organizationId,
      body.currentPassword,
      body.newPassword,
    );
  }

  /**
   * GET /api/users/team
   * Get all team members in the organization
   */
  @Get('team')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getTeamMembers(@Req() req: any) {
    return this.usersService.getTeamMembers(req.user.organizationId);
  }

  /**
   * PUT /api/users/:id/role
   * Update user role (ADMIN only)
   */
  @Put(':id/role')
  @Roles(UserRole.ADMIN)
  async updateUserRole(
    @Param('id') userId: string,
    @Body('role') role: UserRole,
    @Req() req: any,
  ) {
    return this.usersService.updateUserRole(
      userId,
      role,
      req.user.id,
      req.user.organizationId,
    );
  }

  /**
   * DELETE /api/users/:id
   * Delete user (ADMIN only)
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteUser(@Param('id') userId: string, @Req() req: any) {
    return this.usersService.deleteUser(
      userId,
      req.user.id,
      req.user.organizationId,
    );
  }

  /**
   * POST /api/users/team/invite
   * Create invitation for new team member
   */
  @Post('team/invite')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async inviteTeamMember(
    @Req() req: any,
    @Body() body: { email: string; role?: string },
  ) {
    const invitation = await this.usersService.createInvitation(
      req.user.organizationId,
      req.user.id,
      body.email,
      body.role || 'user',
    );

    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/accept-invite?token=${invitation.token}`;

    return {
      ...invitation,
      inviteUrl,
    };
  }

  /**
   * GET /api/users/team/invitations
   * Get all pending invitations
   */
  @Get('team/invitations')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getInvitations(@Req() req: any) {
    return this.usersService.getInvitations(req.user.organizationId);
  }

  /**
   * DELETE /api/users/team/invitations/:id
   * Revoke/cancel invitation
   */
  @Delete('team/invitations/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async revokeInvitation(@Req() req: any, @Param('id') id: string) {
    return this.usersService.revokeInvitation(id, req.user.organizationId);
  }
}
