import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
