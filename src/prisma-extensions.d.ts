
import { Conversation } from '@prisma/client';

declare module '@prisma/client' {
  export interface Conversation {
    activeFlowId: string | null;
    activeFlowNodeId: string | null;
    flowState: any | null;
    flowResumeAt: Date | null;
  }
}
