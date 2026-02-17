import { Module } from '@nestjs/common';
import { ChatbotFlowsController } from './chatbot-flows.controller';
import { ChatbotFlowsService } from './chatbot-flows.service';
import { FlowEngineService } from './flow-engine.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChatbotFlowsController],
  providers: [ChatbotFlowsService, FlowEngineService],
  exports: [ChatbotFlowsService, FlowEngineService],
})
export class ChatbotFlowsModule {}
