import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * สร้าง note ใหม่
   */
  async createNote(data: {
    organizationId: string;
    conversationId?: string;
    customerId?: string;
    content: string;
    type?: string;
    visibility?: string;
    tags?: string[];
    createdBy: string;
  }) {
    this.logger.log(`📝 Creating note for org: ${data.organizationId}`);

    return this.prisma.note.create({
      data: {
        organizationId: data.organizationId,
        conversationId: data.conversationId,
        customerId: data.customerId,
        content: data.content,
        type: data.type || 'general',
        visibility: data.visibility || 'internal',
        tags: data.tags || [],
        createdBy: data.createdBy,
      },
    });
  }

  /**
   * ดึง notes ทั้งหมด (filter ตาม conversation, customer, search, tags)
   */
  async getNotes(
    organizationId: string,
    filters?: {
      conversationId?: string;
      customerId?: string;
      type?: string;
      visibility?: string;
      search?: string;
      tag?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    this.logger.log(`📋 Fetching notes for org: ${organizationId}`);

    const where: any = {
      organizationId,
    };

    if (filters?.conversationId) {
      where.conversationId = filters.conversationId;
    }

    if (filters?.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters?.type) {
      where.type = filters.type;
    }

    if (filters?.visibility) {
      where.visibility = filters.visibility;
    }

    // Search in content
    if (filters?.search) {
      where.content = {
        contains: filters.search,
      };
    }

    // Date range filter
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    const notes = await this.prisma.note.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        conversation: {
          include: {
            customer: true,
          },
        },
        customer: true,
      },
      orderBy: [
        {
          isPinned: 'desc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });

    // Filter by tag if provided (tags are stored as JSON array)
    if (filters?.tag) {
      return notes.filter((note) => {
        const tags = note.tags as string[] | null;
        return tags && tags.includes(filters.tag!);
      });
    }

    return notes;
  }

  /**
   * ดึง note เดียว
   */
  async getNote(organizationId: string, noteId: string) {
    return this.prisma.note.findFirst({
      where: {
        id: noteId,
        organizationId,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * อัปเดต note
   */
  async updateNote(
    organizationId: string,
    noteId: string,
    data: {
      content?: string;
      type?: string;
      visibility?: string;
      tags?: string[];
    },
  ) {
    this.logger.log(`✏️ Updating note: ${noteId}`);

    // ตรวจสอบว่า note อยู่ใน org นี้
    const note = await this.prisma.note.findFirst({
      where: {
        id: noteId,
        organizationId,
      },
    });

    if (!note) {
      throw new Error('Note not found');
    }

    // บันทึกประวัติก่อนแก้ไข
    await this.prisma.noteHistory.create({
      data: {
        noteId: note.id,
        content: note.content,
        type: note.type,
        editedBy: note.createdBy,
      },
    });

    return this.prisma.note.update({
      where: { id: noteId },
      data,
    });
  }

  /**
   * ปักหมุด/ยกเลิกปักหมุด note
   */
  async togglePinNote(organizationId: string, noteId: string) {
    this.logger.log(`📌 Toggling pin for note: ${noteId}`);

    // ตรวจสอบว่า note อยู่ใน org นี้
    const note = await this.prisma.note.findFirst({
      where: {
        id: noteId,
        organizationId,
      },
    });

    if (!note) {
      throw new Error('Note not found');
    }

    return this.prisma.note.update({
      where: { id: noteId },
      data: {
        isPinned: !note.isPinned,
      },
    });
  }

  /**
   * ดึงประวัติการแก้ไข note
   */
  async getNoteHistory(organizationId: string, noteId: string) {
    // ตรวจสอบว่า note อยู่ใน org นี้
    const note = await this.prisma.note.findFirst({
      where: {
        id: noteId,
        organizationId,
      },
    });

    if (!note) {
      throw new Error('Note not found');
    }

    return this.prisma.noteHistory.findMany({
      where: {
        noteId,
      },
      include: {
        editor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        editedAt: 'desc',
      },
    });
  }

  /**
   * ลบ note
   */
  async deleteNote(organizationId: string, noteId: string) {
    this.logger.log(`🗑️ Deleting note: ${noteId}`);

    // ตรวจสอบว่า note อยู่ใน org นี้
    const note = await this.prisma.note.findFirst({
      where: {
        id: noteId,
        organizationId,
      },
    });

    if (!note) {
      throw new Error('Note not found');
    }

    return this.prisma.note.delete({
      where: { id: noteId },
    });
  }
}
