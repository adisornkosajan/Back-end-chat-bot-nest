import { Module, forwardRef } from '@nestjs/common';
import { ChatbotFlowsController } from './chatbot-flows.controller';
import { ChatbotFlowsService } from './chatbot-flows.service';
import { FlowEngineService } from './flow-engine.service';
import { FlowSchedulerService } from './flow-scheduler.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [PrismaModule, forwardRef(() => MessagingModule)],
  controllers: [ChatbotFlowsController],
  providers: [ChatbotFlowsService, FlowEngineService, FlowSchedulerService],
  exports: [ChatbotFlowsService, FlowEngineService],
})
export class ChatbotFlowsModule {}
