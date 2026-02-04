import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'))
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboard(@Req() req: any) {
    return this.analyticsService.getDashboardStats(req.user.organizationId);
  }

  @Get('trend')
  async getTrend(@Req() req: any, @Query('days') days?: string) {
    const daysCount = days ? parseInt(days, 10) : 7;
    return this.analyticsService.getConversationTrend(
      req.user.organizationId,
      daysCount,
    );
  }

  @Get('peak-hours')
  async getPeakHours(@Req() req: any) {
    return this.analyticsService.getPeakHours(req.user.organizationId);
  }
}
