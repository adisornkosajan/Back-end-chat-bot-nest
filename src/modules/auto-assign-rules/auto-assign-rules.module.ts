import { Module } from '@nestjs/common';
import { AutoAssignRulesController } from './auto-assign-rules.controller';
import { AutoAssignRulesService } from './auto-assign-rules.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AutoAssignRulesController],
  providers: [AutoAssignRulesService],
  exports: [AutoAssignRulesService],
})
export class AutoAssignRulesModule {}
