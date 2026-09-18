import { describe, expect, it } from "vitest";

import {
  addAssistantMessage,
  addUserMessage,
  bindPersistedUserMessage,
  createChatState,
  beginEdit,
  mergeDraftPatch,
  prepareRetry,
  stopGeneration,
  acceptCaseVersion,
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

  it("prepares a retry from the latest stored user turn without duplicating history", () => {
    const userState = addUserMessage(createChatState(), "上一轮描述");
    const state = addAssistantMessage(
      {
        ...userState,
        messages: userState.messages.map((message) =>
          message.role === "user"
            ? { ...message, persistedMessageId: "stored-user-id" }
            : message,
        ),
      },
      { id: "assistant-1", content: "上一轮回复" },
    );
    const result = prepareRetry(state);

    expect(result.content).toBe("上一轮描述");
    expect(result.messageId).toBe("stored-user-id");
    expect(result.state.messages).toBe(state.messages);
    expect(result.state.messages).toHaveLength(3);
    expect(result.state.status).toBe("sending");
  });

  it("binds a server-issued id to one user message without changing its history", () => {
    const state = addUserMessage(createChatState(), "上一轮描述");
    const bound = bindPersistedUserMessage(state, "user-1", "stored-user-id");

    expect(bound.messages[1]).toMatchObject({
      id: "user-1",
      role: "user",
      content: "上一轮描述",
      persistedMessageId: "stored-user-id",
    });
    expect(bound.messages[0]).toBe(state.messages[0]);
    expect(state.messages[1]).not.toHaveProperty("persistedMessageId");
  });

  it("merges patches without exposing scoring fields", () => {
    const state = mergeDraftPatch(createChatState(), {
      facts: [],
      metadata: { score: 0.9 },
    });

    expect(state.draftPatch).toEqual({ facts: [] });
  });

  it("never regresses the local case version when a replay is older", () => {
    expect(acceptCaseVersion(5, 3)).toBe(5);
    expect(acceptCaseVersion(5, 6)).toBe(6);
    expect(acceptCaseVersion(undefined, 2)).toBe(2);
    expect(acceptCaseVersion(5, undefined)).toBe(5);
  });
});
