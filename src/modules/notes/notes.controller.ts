import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotesService } from './notes.service';

@Controller('notes')
@UseGuards(AuthGuard('jwt'))
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  /**
   * สร้าง note ใหม่
   */
  @Post()
  async createNote(
    @Req() req: any,
    @Body()
    body: {
      conversationId?: string;
      customerId?: string;
      content: string;
      type?: string;
      visibility?: string;
      tags?: string[];
    },
  ) {
    return this.notesService.createNote({
      organizationId: req.user.organizationId,
      conversationId: body.conversationId,
      customerId: body.customerId,
      content: body.content,
      type: body.type,
      visibility: body.visibility,
      tags: body.tags,
      createdBy: req.user.id,
    });
  }

  /**
   * ดึง notes ทั้งหมด (filter ได้)
   */
  @Get()
  async getNotes(
    @Req() req: any,
    @Query('conversationId') conversationId?: string,
    @Query('customerId') customerId?: string,
    @Query('type') type?: string,
    @Query('visibility') visibility?: string,
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.notesService.getNotes(req.user.organizationId, {
      conversationId,
      customerId,
      type,
      visibility,
      search,
      tag,
      startDate,
      endDate,
    });
  }

  /**
   * ดึง note เดียว
   */
  @Get(':id')
  async getNote(@Req() req: any, @Param('id') id: string) {
    return this.notesService.getNote(req.user.organizationId, id);
  }

  /**
   * ดึงประวัติการแก้ไข note
   */
  @Get(':id/history')
  async getNoteHistory(@Req() req: any, @Param('id') id: string) {
    return this.notesService.getNoteHistory(req.user.organizationId, id);
  }

  /**
   * อัปเดต note
   */
  @Put(':id')
  async updateNote(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      content?: string;
      type?: string;
      visibility?: string;
      tags?: string[];
    },
  ) {
    return this.notesService.updateNote(req.user.organizationId, id, body);
  }

  /**
   * ปักหมุด/ยกเลิกปักหมุด note
   */
  @Put(':id/pin')
  async togglePinNote(@Req() req: any, @Param('id') id: string) {
    return this.notesService.togglePinNote(req.user.organizationId, id);
  }

  /**
   * ลบ note
   */
  @Delete(':id')
  async deleteNote(@Req() req: any, @Param('id') id: string) {
    await this.notesService.deleteNote(req.user.organizationId, id);
    return { message: 'Note deleted successfully' };
  }
}
