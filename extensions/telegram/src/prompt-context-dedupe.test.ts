import { describe, expect, it } from "vitest";
import {
  type TelegramPromptContextMessageForDedupe,
  mergeTelegramPromptContextMessages,
  resolvePromptContextTextDedupeKey,
} from "./prompt-context-dedupe.js";

function mergeWithAssistantCacheIds(params: {
  sessionPromptMessages: readonly TelegramPromptContextMessageForDedupe[];
  cachePromptMessages: readonly TelegramPromptContextMessageForDedupe[];
  assistantCacheMessageIds: readonly string[];
}) {
  const assistantCacheMessageIds = new Set(params.assistantCacheMessageIds);
  return mergeTelegramPromptContextMessages({
    sessionPromptMessages: params.sessionPromptMessages,
    cachePromptMessages: params.cachePromptMessages,
    isAssistantCacheMessage: (message) =>
      typeof message.message_id === "string" && assistantCacheMessageIds.has(message.message_id),
  });
}

describe("resolvePromptContextTextDedupeKey", () => {
  it("matches assistant transcript text to Telegram cache text after stripping directive tags", () => {
    expect(
      resolvePromptContextTextDedupeKey({
        timestamp_ms: 1_778_474_760_000,
        body: "[[reply_to_current]]Yep - I'm here now.",
      }),
    ).toBe(
      resolvePromptContextTextDedupeKey({
        timestamp_ms: 1_778_474_760_000,
        body: "Yep - I'm here now.",
      }),
    );
  });

  it("keeps timestamp alignment in the dedupe key", () => {
    expect(
      resolvePromptContextTextDedupeKey({
        timestamp_ms: 1_778_474_760_000,
        body: "[[reply_to_current]]Yep - I'm here now.",
      }),
    ).not.toBe(
      resolvePromptContextTextDedupeKey({
        timestamp_ms: 1_778_474_761_000,
        body: "Yep - I'm here now.",
      }),
    );
  });

  it("filters directive-tagged session rows when a cache row has the same visible text", () => {
    const result = mergeWithAssistantCacheIds({
      sessionPromptMessages: [
        {
          message_id: "session:assistant-with-reply-directive",
          sender: "OpenClaw",
          timestamp_ms: 1_778_474_760_000,
          body: "[[reply_to_current]]Yep - I'm here now.",
        },
      ],
      cachePromptMessages: [
        {
          message_id: "736",
          sender: "OpenClaw",
          timestamp_ms: 1_778_474_760_000,
          body: "Yep - I'm here now.",
        },
      ],
      assistantCacheMessageIds: ["736"],
    });

    expect(result.sessionOnlyPromptMessages).toEqual([]);
    expect(result.promptMessages).toEqual([
      {
        message_id: "736",
        sender: "OpenClaw",
        timestamp_ms: 1_778_474_760_000,
        body: "Yep - I'm here now.",
      },
    ]);
  });

  it("filters inline directive-tagged session rows using delivery-normalized text", () => {
    const result = mergeWithAssistantCacheIds({
      sessionPromptMessages: [
        {
          message_id: "session:inline-reply-directive",
          sender: "OpenClaw",
          timestamp_ms: 1_778_474_760_000,
          body: "hello [[reply_to_current]] world",
        },
      ],
      cachePromptMessages: [
        {
          message_id: "736",
          sender: "OpenClaw",
          timestamp_ms: 1_778_474_760_000,
          body: "hello world",
        },
      ],
      assistantCacheMessageIds: ["736"],
    });

    expect(result.sessionOnlyPromptMessages).toEqual([]);
    expect(result.promptMessages).toEqual([
      {
        message_id: "736",
        sender: "OpenClaw",
        timestamp_ms: 1_778_474_760_000,
        body: "hello world",
      },
    ]);
  });

  it("filters directive-tagged session rows when the delivered cache timestamp drifts", () => {
    const result = mergeWithAssistantCacheIds({
      sessionPromptMessages: [
        {
          message_id: "session:bc268f12",
          sender: "OpenClaw",
          timestamp_ms: 1_783_019_792_000,
          body: "[[reply_to_current]]Duplicate context test reply - issue 99117",
        },
      ],
      cachePromptMessages: [
        {
          message_id: "808",
          sender: "OpenClaw",
          timestamp_ms: 1_783_019_798_000,
          body: "Duplicate context test reply - issue 99117",
        },
      ],
      assistantCacheMessageIds: ["808"],
    });

    expect(result.sessionOnlyPromptMessages).toEqual([]);
    expect(result.promptMessages.map((message) => message.message_id)).toEqual(["808"]);
  });

  it("filters directive-tagged session rows for custom-named assistant cache rows", () => {
    const result = mergeWithAssistantCacheIds({
      sessionPromptMessages: [
        {
          message_id: "session:custom-bot-name",
          sender: "OpenClaw",
          timestamp_ms: 1_783_019_792_000,
          body: "[[reply_to_current]]Custom bot display names still dedupe.",
        },
      ],
      cachePromptMessages: [
        {
          message_id: "808",
          sender: "Molty Support Bot",
          timestamp_ms: 1_783_019_798_000,
          body: "Custom bot display names still dedupe.",
        },
      ],
      assistantCacheMessageIds: ["808"],
    });

    expect(result.sessionOnlyPromptMessages).toEqual([]);
    expect(result.promptMessages.map((message) => message.message_id)).toEqual(["808"]);
  });

  it("keeps both plain session and cache rows when visible text matches but timestamps differ", () => {
    const result = mergeWithAssistantCacheIds({
      sessionPromptMessages: [
        {
          message_id: "session:assistant-with-reply-directive",
          sender: "OpenClaw",
          timestamp_ms: 1_778_474_760_000,
          body: "Yep - I'm here now.",
        },
      ],
      cachePromptMessages: [
        {
          message_id: "736",
          sender: "OpenClaw",
          timestamp_ms: 1_778_474_761_000,
          body: "Yep - I'm here now.",
        },
      ],
      assistantCacheMessageIds: ["736"],
    });

    expect(result.sessionOnlyPromptMessages).toHaveLength(1);
    expect(result.promptMessages.map((message) => message.message_id)).toEqual([
      "session:assistant-with-reply-directive",
      "736",
    ]);
  });

  it("keeps directive-tagged session rows when only a user cache row has matching visible text", () => {
    const result = mergeWithAssistantCacheIds({
      sessionPromptMessages: [
        {
          message_id: "session:assistant-with-reply-directive",
          sender: "OpenClaw",
          timestamp_ms: 1_783_019_792_000,
          body: "[[reply_to_current]]same visible text",
        },
      ],
      cachePromptMessages: [
        {
          message_id: "807",
          sender: "User",
          timestamp_ms: 1_783_019_792_000,
          body: "same visible text",
        },
        {
          message_id: "808",
          sender: "User",
          timestamp_ms: 1_783_019_798_000,
          body: "same visible text",
        },
      ],
      assistantCacheMessageIds: [],
    });

    expect(result.sessionOnlyPromptMessages).toHaveLength(1);
    expect(result.promptMessages.map((message) => message.message_id)).toEqual([
      "session:assistant-with-reply-directive",
      "807",
      "808",
    ]);
  });
});
