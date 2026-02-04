import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
import { AssignmentService } from './assignment.service';
import { AssignmentController } from './assignment.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { AiModule } from '../ai/ai.module';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    RealtimeModule,
    AiModule,
    PluginsModule,
  ],
  providers: [MessagingService, AssignmentService],
  controllers: [MessagingController, AssignmentController],
  exports: [MessagingService, AssignmentService],
})
export class MessagingModule {}
