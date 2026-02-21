import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContactsService } from './contacts.service';

@Controller('contacts')
@UseGuards(AuthGuard('jwt'))
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  /**
   * GET /api/contacts — List contacts with search/filter/pagination
   */
  @Get()
  async listContacts(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('tagIds') tagIds?: string,
    @Query('platformId') platformId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contactsService.listContacts(req.user.organizationId, {
      search,
      tagIds: tagIds ? tagIds.split(',') : undefined,
      platformId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  /**
   * GET /api/contacts/stats — Contact statistics
   */
  @Get('stats')
  async getStats(@Req() req: any) {
    return this.contactsService.getContactStats(req.user.organizationId);
  }

  /**
   * GET /api/contacts/tags — List all tags
   */
  @Get('tags')
  async listTags(@Req() req: any) {
    return this.contactsService.listTags(req.user.organizationId);
  }

  /**
   * POST /api/contacts/tags — Create a new tag
   */
  @Post('tags')
  async createTag(
    @Req() req: any,
    @Body() body: { name: string; color?: string },
  ) {
    return this.contactsService.createTag(req.user.organizationId, body);
  }

  /**
   * PATCH /api/contacts/tags/:tagId — Update a tag
   */
  @Patch('tags/:tagId')
  async updateTag(
    @Req() req: any,
    @Param('tagId') tagId: string,
    @Body() body: { name?: string; color?: string },
  ) {
    return this.contactsService.updateTag(req.user.organizationId, tagId, body);
  }

  /**
   * DELETE /api/contacts/tags/:tagId — Delete a tag
   */
  @Delete('tags/:tagId')
  async deleteTag(@Req() req: any, @Param('tagId') tagId: string) {
    return this.contactsService.deleteTag(req.user.organizationId, tagId);
  }

  /**
   * GET /api/contacts/:id — Get contact detail
   */
  @Get(':id')
  async getContact(@Req() req: any, @Param('id') id: string) {
    return this.contactsService.getContact(req.user.organizationId, id);
  }

  /**
   * PATCH /api/contacts/:id — Update contact info
   */
  @Patch(':id')
  async updateContact(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; phone?: string; importantKey?: string },
  ) {
    const userId = req.user?.id || req.user?.sub || req.user?.userId;
    return this.contactsService.updateContact(
      req.user.organizationId,
      id,
      body,
      userId,
    );
  }

  /**
   * POST /api/contacts/:id/tags/:tagId — Add tag to contact
   */
  @Post(':id/tags/:tagId')
  async addTag(
    @Req() req: any,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contactsService.addTagToCustomer(
      req.user.organizationId,
      id,
      tagId,
    );
  }

  /**
   * DELETE /api/contacts/:id/tags/:tagId — Remove tag from contact
   */
  @Delete(':id/tags/:tagId')
  async removeTag(
    @Req() req: any,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.contactsService.removeTagFromCustomer(
      req.user.organizationId,
      id,
      tagId,
    );
  }
}
