import { describe, expect, it } from "vitest";

import {
  addAssistantMessage,
  addUserMessage,
  createChatState,
  beginEdit,
  mergeDraftPatch,
  prepareRetry,
  stopGeneration,
} from "@/components/chat/chat-state";

describe("chat state", () => {
  it("starts with a safe assistant welcome and no draft", () => {
    const state = createChatState();

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: "assistant", id: "welcome" });
    expect(state.status).toBe("idle");
    expect(state.draftPatch).toBeUndefined();
  });

  it("keeps the user message on the right-side conversation stream", () => {
    const state = addUserMessage(createChatState(), "我想先记录发生了什么");

    expect(state.messages.at(-1)).toMatchObject({
      role: "user",
      content: "我想先记录发生了什么",
    });
    expect(state.status).toBe("sending");
  });

  it("adds the assistant response and merges a structured draft patch", () => {
    const state = addAssistantMessage(
      addUserMessage(createChatState(), "我被扣留护照"),
      {
        id: "assistant-1",
        content: "我已整理这轮内容，请你核对。",
        patch: {
          facts: [
            {
              id: "fact-1",
              field: "证件控制",
              value: "护照被扣留",
              sourceMessageIds: ["message-1"],
              sourceQuote: "我被扣留护照",
              certainty: "user_stated",
            },
          ],
        },
      },
    );

    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", id: "assistant-1" });
    expect(state.status).toBe("review");
    expect(state.draftPatch?.facts).toHaveLength(1);
  });

  it("stops generation without removing the typed message history", () => {
    const state = addUserMessage(createChatState(), "先停一下");

    expect(stopGeneration(state)).toMatchObject({ status: "idle" });
    expect(stopGeneration(state).messages).toHaveLength(2);
  });

  it("returns the selected user message for edit without erasing the conversation", () => {
    const state = addUserMessage(createChatState(), "请更正这一段");
    const result = beginEdit(state, "user-1");

    expect(result.content).toBe("请更正这一段");
    expect(result.state.messages).toHaveLength(2);
    expect(result.state.status).toBe("idle");
  });

  it("prepares a retry from the latest user turn and keeps the previous turn visible", () => {
    const state = addAssistantMessage(
      addUserMessage(createChatState(), "上一轮描述"),
      { id: "assistant-1", content: "上一轮回复" },
    );
    const result = prepareRetry(state);

    expect(result.content).toBe("上一轮描述");
    expect(result.state.messages.at(-1)).toMatchObject({ role: "user", content: "上一轮描述" });
    expect(result.state.messages).toHaveLength(4);
    expect(result.state.status).toBe("sending");
  });

  it("merges patches without exposing scoring fields", () => {
    const state = mergeDraftPatch(createChatState(), {
      facts: [],
      metadata: { score: 0.9 },
    });

    expect(state.draftPatch).toEqual({ facts: [] });
  });
});
