import { Controller, Post, Get, Put, Body, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * GET /api/organizations/current
   * Get current user's organization
   */
  @Get('current')
  @UseGuards(AuthGuard('jwt'))
  async getCurrentOrganization(@Req() req: any) {
    return this.organizationsService.findById(req.user.organizationId);
  }

  /**
   * PUT /api/organizations/current
   * Update current user's organization
   */
  @Put('current')
  @UseGuards(AuthGuard('jwt'))
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
  async getAllOrganizations() {
    return this.organizationsService.getAllOrganizations();
  }

  /**
   * GET /api/organizations/:id
   * ดูข้อมูล organization
   */
  @Get(':id')
  async getOrganization(@Param('id') id: string) {
    return this.organizationsService.findById(id);
  }
}
