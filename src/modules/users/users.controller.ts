import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
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
  async getTeamMembers(@Req() req: any) {
    return this.usersService.getTeamMembers(req.user.organizationId);
  }

  /**
   * POST /api/users/team/invite
   * Create invitation for new team member
   */
  @Post('team/invite')
  async inviteTeamMember(
    @Req() req: any,
    @Body() body: { email: string; role?: string },
  ) {
    console.log('🔍 req.user:', req.user);
    console.log('🔍 req.user.id:', req.user?.id);
    console.log('🔍 req.user.organizationId:', req.user?.organizationId);
    
    const invitation = await this.usersService.createInvitation(
      req.user.organizationId,
      req.user.id,
      body.email,
      body.role || 'user',
    );

    // Generate invite URL
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
  async getInvitations(@Req() req: any) {
    return this.usersService.getInvitations(req.user.organizationId);
  }

  /**
   * DELETE /api/users/team/invitations/:id
   * Revoke/cancel invitation
   */
  @Delete('team/invitations/:id')
  async revokeInvitation(@Req() req: any, @Param('id') id: string) {
    return this.usersService.revokeInvitation(id, req.user.organizationId);
  }
}
