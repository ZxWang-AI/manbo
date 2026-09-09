"use client";

import type { FormEvent, KeyboardEvent } from "react";

import { RealtimeVoice } from "./realtime-voice";
import { VoiceInput } from "./voice-input";

export function Composer({
  value,
  busy,
  blocked,
  onChange,
  onSubmit,
  onStop,
}: {
  value: string;
  busy: boolean;
  blocked: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && !blocked) onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!busy && !blocked) onSubmit();
    }
  }

  return (
    <form className="composer" aria-label="消息输入" onSubmit={submit}>
      <label className="sr-only" htmlFor="message-input">描述你的经历</label>
      <textarea
        id="message-input"
        name="message"
        rows={3}
        maxLength={10_000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="从你愿意分享的部分开始……"
      />
      <div className="composer__tools">
        <span>Enter 发送 · Shift + Enter 换行</span>
        <div className="composer__actions">
          <VoiceInput />
          <RealtimeVoice />
          {busy ? (
            <button type="button" className="stop-button" onClick={onStop}>停止生成</button>
          ) : (
            <button type="submit" className="send-button" aria-label="发送" disabled={blocked}>↑</button>
          )}
        </div>
      </div>
    </form>
  );
}
