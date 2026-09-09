"use client";

import { useState } from "react";

export function VoiceInput() {
  const [recording, setRecording] = useState(false);

  return (
    <button
      type="button"
      className={`icon-button ${recording ? "icon-button--active" : ""}`}
      aria-label={recording ? "停止录音输入" : "录音输入"}
      aria-pressed={recording}
      onClick={() => setRecording((value) => !value)}
    >
      <span aria-hidden="true">{recording ? "■" : "◉"}</span>
      <span>{recording ? "停止录音" : "录音输入"}</span>
    </button>
  );
}
