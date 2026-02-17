import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
import { AssignmentService } from './assignment.service';
import { AssignmentController } from './assignment.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { AiModule } from '../ai/ai.module';
import { PluginsModule } from '../plugins/plugins.module';
import { ChatbotFlowsModule } from '../chatbot-flows/chatbot-flows.module';
import { AutoAssignRulesModule } from '../auto-assign-rules/auto-assign-rules.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RealtimeModule,
    AiModule,
    PluginsModule,
    PluginsModule,
    forwardRef(() => ChatbotFlowsModule),
    AutoAssignRulesModule,
    AutoAssignRulesModule,
  ],
  providers: [MessagingService, AssignmentService],
  controllers: [MessagingController, AssignmentController],
  exports: [MessagingService, AssignmentService],
})
export class MessagingModule {}

