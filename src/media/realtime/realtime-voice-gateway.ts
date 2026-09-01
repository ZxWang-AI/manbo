import type {
  RealtimeVoiceEvent,
  RealtimeVoiceEventType,
  VoiceSessionConfig,
} from "@/domain/voice-session";

export interface RealtimeVoiceEventRepository {
  append(event: RealtimeVoiceEvent): Promise<RealtimeVoiceEvent>;
  list(sessionId: string, afterSequence?: number): Promise<RealtimeVoiceEvent[]>;
}

export interface RealtimeVoiceGateway {
  start(session: VoiceSessionConfig): Promise<{ sessionId: string }>;
  appendAudio(sessionId: string, chunk: Uint8Array): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  setMuted(sessionId: string, muted: boolean): Promise<void>;
  switchToText(sessionId: string): Promise<void>;
  end(sessionId: string): Promise<void>;
}

export class InMemoryRealtimeVoiceGateway implements RealtimeVoiceGateway {
  private readonly sequences = new Map<string, number>();

  constructor(private readonly events: RealtimeVoiceEventRepository) {}

  async start(session: VoiceSessionConfig): Promise<{ sessionId: string }> {
    if (this.sequences.has(session.sessionId)) return { sessionId: session.sessionId };
    this.sequences.set(session.sessionId, 0);
    await this.appendEvent(session.sessionId, "session_started", null);
    return { sessionId: session.sessionId };
  }

  async appendAudio(sessionId: string, chunk: Uint8Array): Promise<void> {
    this.assertSession(sessionId);
    if (chunk.byteLength === 0) throw new Error("VOICE_AUDIO_CHUNK_EMPTY");
  }

  appendCaption(
    sessionId: string,
    type: "user_caption" | "assistant_caption",
    text: string,
  ): Promise<RealtimeVoiceEvent> {
    if (!text.trim()) throw new Error("VOICE_CAPTION_EMPTY");
    return this.appendEvent(sessionId, type, text.trim());
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.appendEvent(sessionId, "assistant_interrupted", null);
  }

  async setMuted(sessionId: string, muted: boolean): Promise<void> {
    await this.appendEvent(sessionId, muted ? "muted" : "unmuted", null);
  }

  async switchToText(sessionId: string): Promise<void> {
    await this.appendEvent(sessionId, "switched_to_text", null);
  }

  async end(sessionId: string): Promise<void> {
    await this.appendEvent(sessionId, "session_ended", null);
  }

  reconnect(sessionId: string, afterSequence: number): Promise<RealtimeVoiceEvent[]> {
    this.assertSession(sessionId);
    return this.events.list(sessionId, afterSequence);
  }

  private assertSession(sessionId: string): void {
    if (!this.sequences.has(sessionId)) throw new Error("VOICE_SESSION_UNAVAILABLE");
  }

  private appendEvent(
    sessionId: string,
    type: RealtimeVoiceEventType,
    text: string | null,
  ): Promise<RealtimeVoiceEvent> {
    this.assertSession(sessionId);
    const sequence = (this.sequences.get(sessionId) ?? 0) + 1;
    this.sequences.set(sessionId, sequence);
    return this.events.append({ sessionId, sequence, type, text });
  }
}
