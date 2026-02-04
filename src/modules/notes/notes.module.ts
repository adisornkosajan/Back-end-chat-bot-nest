import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { CustomerSummaryController } from './customer-summary.controller';
import { CustomerSummaryService } from './customer-summary.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotesController, CustomerSummaryController],
  providers: [NotesService, CustomerSummaryService],
  exports: [NotesService, CustomerSummaryService],
})
export class NotesModule {}
