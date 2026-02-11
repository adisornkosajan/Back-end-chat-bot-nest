import { Controller, Post, Get, Put, Body, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrganizationsService } from './organizations.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';

@Controller('organizations')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * GET /api/organizations/current
   * Get current user's organization
   */
  @Get('current')
  async getCurrentOrganization(@Req() req: any) {
    return this.organizationsService.findById(req.user.organizationId);
  }

  /**
   * PUT /api/organizations/current
   * Update current user's organization
   */
  @Put('current')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async updateCurrentOrganization(
    @Req() req: any,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.organizationsService.updateOrganization(req.user.organizationId, body);
  }

  /**
   * POST /api/organizations
   * สร้าง organization ใหม่พร้อม admin user
   * สำหรับผู้ให้บริการที่ขายแอปให้องค์กร
   */
  @Post()
  @Roles(UserRole.ADMIN)
  async createOrganization(
    @Body()
    body: {
      organizationName: string;
      adminName: string;
      adminEmail: string;
      adminPassword: string;
      role?: string;
    },
  ) {
    return this.organizationsService.createOrganizationWithAdmin(body);
  }

  /**
   * POST /api/organizations/:id/users
   * เพิ่ม user เข้า organization โดยตรง
   * ไม่ต้องผ่าน invitation system
   */
  @Post(':id/users')
  @Roles(UserRole.ADMIN)
  async addUser(
    @Param('id') organizationId: string,
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      role?: string;
    },
  ) {
    return this.organizationsService.addUserToOrganization(organizationId, body);
  }

  /**
   * GET /api/organizations
   * ดูรายการ organization ทั้งหมด (สำหรับ super admin)
   */
  @Get()
  @Roles(UserRole.ADMIN)
  async getAllOrganizations() {
    return this.organizationsService.getAllOrganizations();
  }

  /**
   * GET /api/organizations/:id
   * ดูข้อมูล organization
   */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  async getOrganization(@Param('id') id: string) {
    return this.organizationsService.findById(id);
  }
}
