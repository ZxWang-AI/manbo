import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { RealtimeVoiceEvent } from "@/domain/voice-session";
import type { RealtimeVoiceEventRepository } from "@/media/realtime/realtime-voice-gateway";

export class PrismaRealtimeVoiceEventRepository implements RealtimeVoiceEventRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly accountId: string,
    private readonly caseId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async append(event: RealtimeVoiceEvent): Promise<RealtimeVoiceEvent> {
    const rows = await this.database.$queryRaw<Array<{ sequence: number }>>(Prisma.sql`
      SELECT * FROM manbo_append_realtime_voice_event(
        ${randomUUID()}::uuid,
        ${event.sessionId}::uuid,
        ${this.accountId},
        ${this.caseId}::uuid,
        ${event.type}::"RealtimeVoiceEventType",
        ${event.text},
        ${this.now()}
      )
    `);
    const sequence = rows[0]?.sequence;
    if (!sequence) throw new Error("VOICE_EVENT_APPEND_FAILED");
    return { ...event, sequence };
  }

  async list(sessionId: string, afterSequence = 0): Promise<RealtimeVoiceEvent[]> {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new TypeError("afterSequence must be a non-negative integer");
    }
    const rows = await this.database.realtimeVoiceEvent.findMany({
      where: {
        sessionId,
        accountId: this.accountId,
        caseId: this.caseId,
        sequence: { gt: afterSequence },
        session: {
          is: {
            sessionId,
            accountId: this.accountId,
            caseId: this.caseId,
          },
        },
      },
      orderBy: { sequence: "asc" },
      select: { sessionId: true, sequence: true, type: true, text: true },
    });
    return rows;
  }
}
