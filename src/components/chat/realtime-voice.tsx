"use client";

import { useState } from "react";

export function RealtimeVoice() {
  const [active, setActive] = useState(false);

  return (
    <button
      type="button"
      className={`icon-button ${active ? "icon-button--active" : ""}`}
      aria-label={active ? "结束实时语音" : "开始实时语音"}
      aria-pressed={active}
      onClick={() => setActive((value) => !value)}
    >
      <span aria-hidden="true">{active ? "◌" : "◍"}</span>
      <span>{active ? "结束实时语音" : "实时语音"}</span>
    </button>
  );
}
