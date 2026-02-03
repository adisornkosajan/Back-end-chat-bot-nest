import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
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
  providers: [MessagingService],
  controllers: [MessagingController],
  exports: [MessagingService],
})
export class MessagingModule {}
