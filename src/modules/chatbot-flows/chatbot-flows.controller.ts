import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthGuard } from '@nestjs/passport';
import { ChatbotFlowsService, FlowNode } from './chatbot-flows.service';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'chatbot-flows');

@Controller('chatbot-flows')
@UseGuards(AuthGuard('jwt'))
export class ChatbotFlowsController {
  constructor(private readonly flowsService: ChatbotFlowsService) {}

  /**
   * GET /api/chatbot-flows — List all flows
   */
  @Get()
  async list(@Req() req: any) {
    return this.flowsService.listFlows(req.user.organizationId);
  }

  /**
   * GET /api/chatbot-flows/:id — Get flow detail
   */
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.flowsService.getFlow(req.user.organizationId, id);
  }

  /**
   * POST /api/chatbot-flows — Create a new flow
   */
  @Post()
  @UsePipes(new ValidationPipe({ transform: false, whitelist: false }))
  async create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      description?: string;
      triggerKeywords?: string[];
      nodes?: FlowNode[];
    },
  ) {
    return this.flowsService.createFlow(
      req.user.organizationId,
      req.user.userId,
      body,
    );
  }

  /**
   * PATCH /api/chatbot-flows/:id — Update a flow
   */
  @Patch(':id')
  @UsePipes(new ValidationPipe({ transform: false, whitelist: false }))
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      triggerKeywords?: string[];
      nodes?: FlowNode[];
      isActive?: boolean;
    },
  ) {
    console.log('📦 UPDATE body.nodes:', JSON.stringify(body.nodes, null, 2));
    return this.flowsService.updateFlow(req.user.organizationId, id, body);
  }

  /**
   * POST /api/chatbot-flows/:id/toggle — Toggle active/inactive
   */
  @Post(':id/toggle')
  async toggle(@Req() req: any, @Param('id') id: string) {
    return this.flowsService.toggleFlow(req.user.organizationId, id);
  }

  /**
   * DELETE /api/chatbot-flows/:id — Delete a flow
   */
  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.flowsService.deleteFlow(req.user.organizationId, id);
  }

  /**
   * POST /api/chatbot-flows/upload-image — Upload image for flow node
   * Saves to disk, returns URL path
   */
  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(UPLOAD_DIR)) {
            mkdirSync(UPLOAD_DIR, { recursive: true });
          }
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    // Return relative URL that will be served by Express static middleware
    const imageUrl = `/uploads/chatbot-flows/${file.filename}`;
    return { imageUrl };
  }
}
