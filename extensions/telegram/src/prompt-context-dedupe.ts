import { stripInlineDirectiveTagsForDelivery } from "openclaw/plugin-sdk/text-chunking";

export type TelegramPromptContextMessageForDedupe = {
  body?: unknown;
  message_id?: unknown;
  sender?: unknown;
  timestamp_ms?: unknown;
};

type TelegramPromptContextNormalizedText = {
  directiveTagsStripped: boolean;
  text: string;
  timestampMs: number;
};

export type MergeTelegramPromptContextMessagesResult<
  TSessionMessage extends TelegramPromptContextMessageForDedupe,
  TCacheMessage extends TelegramPromptContextMessageForDedupe,
> = {
  sessionOnlyPromptMessages: TSessionMessage[];
  promptMessages: Array<TSessionMessage | TCacheMessage>;
};

const DIRECTIVE_TAG_CACHE_TIMESTAMP_DRIFT_TOLERANCE_MS = 30_000;

function promptContextTimestampForSort(message: TelegramPromptContextMessageForDedupe): number {
  return typeof message.timestamp_ms === "number" && Number.isFinite(message.timestamp_ms)
    ? message.timestamp_ms
    : 0;
}

function resolvePromptContextNormalizedText(
  message: TelegramPromptContextMessageForDedupe,
): TelegramPromptContextNormalizedText | undefined {
  if (typeof message.body !== "string" || !message.body.trim()) {
    return undefined;
  }
  if (typeof message.timestamp_ms !== "number" || !Number.isFinite(message.timestamp_ms)) {
    return undefined;
  }
  const deliveredBody = stripInlineDirectiveTagsForDelivery(message.body);
  const text = deliveredBody.text.trim();
  return text
    ? {
        directiveTagsStripped: deliveredBody.changed,
        text,
        timestampMs: message.timestamp_ms,
      }
    : undefined;
}

function isOpenClawSessionPromptMessage(message: TelegramPromptContextMessageForDedupe): boolean {
  return (
    typeof message.message_id === "string" &&
    message.message_id.startsWith("session:") &&
    isOpenClawPromptMessage(message)
  );
}

function isOpenClawPromptMessage(message: TelegramPromptContextMessageForDedupe): boolean {
  return typeof message.sender === "string" && message.sender.startsWith("OpenClaw");
}

function isWithinDirectiveTagCacheTimestampDrift(
  sessionText: TelegramPromptContextNormalizedText,
  cacheText: TelegramPromptContextNormalizedText,
): boolean {
  return (
    Math.abs(sessionText.timestampMs - cacheText.timestampMs) <=
    DIRECTIVE_TAG_CACHE_TIMESTAMP_DRIFT_TOLERANCE_MS
  );
}

export function resolvePromptContextTextDedupeKey(
  message: TelegramPromptContextMessageForDedupe,
): string | undefined {
  const normalized = resolvePromptContextNormalizedText(message);
  return normalized ? `${normalized.timestampMs}:${normalized.text}` : undefined;
}

function shouldDropSessionPromptMessage(
  sessionMessage: TelegramPromptContextMessageForDedupe,
  cacheTextKeys: ReadonlySet<string>,
  openClawCacheTextKeys: ReadonlySet<string>,
  openClawCacheTexts: readonly TelegramPromptContextNormalizedText[],
): boolean {
  const exactKey = resolvePromptContextTextDedupeKey(sessionMessage);
  const sessionText = resolvePromptContextNormalizedText(sessionMessage);
  if (!sessionText?.directiveTagsStripped || !isOpenClawSessionPromptMessage(sessionMessage)) {
    return exactKey !== undefined && cacheTextKeys.has(exactKey);
  }
  if (exactKey !== undefined && openClawCacheTextKeys.has(exactKey)) {
    return true;
  }
  // Telegram cache rows may still use send-completion time on released builds;
  // only directive-tagged synthetic assistant rows get near-time fallback dedupe.
  return openClawCacheTexts.some(
    (cacheText) =>
      cacheText.text === sessionText.text &&
      isWithinDirectiveTagCacheTimestampDrift(sessionText, cacheText),
  );
}

export function mergeTelegramPromptContextMessages<
  TSessionMessage extends TelegramPromptContextMessageForDedupe,
  TCacheMessage extends TelegramPromptContextMessageForDedupe,
>(params: {
  sessionPromptMessages: readonly TSessionMessage[];
  cachePromptMessages: readonly TCacheMessage[];
}): MergeTelegramPromptContextMessagesResult<TSessionMessage, TCacheMessage> {
  const cacheTextKeys = new Set(
    params.cachePromptMessages
      .map((message) => resolvePromptContextTextDedupeKey(message))
      .filter((key) => key !== undefined),
  );
  const openClawCachePromptMessages = params.cachePromptMessages.filter((message) =>
    isOpenClawPromptMessage(message),
  );
  const openClawCacheTextKeys = new Set(
    openClawCachePromptMessages
      .map((message) => resolvePromptContextTextDedupeKey(message))
      .filter((key) => key !== undefined),
  );
  const openClawCacheTexts = openClawCachePromptMessages
    .map((message) => resolvePromptContextNormalizedText(message))
    .filter((text) => text !== undefined);
  const sessionOnlyPromptMessages = params.sessionPromptMessages.filter(
    (message) =>
      !shouldDropSessionPromptMessage(
        message,
        cacheTextKeys,
        openClawCacheTextKeys,
        openClawCacheTexts,
      ),
  );
  return {
    sessionOnlyPromptMessages,
    promptMessages: [...sessionOnlyPromptMessages, ...params.cachePromptMessages].toSorted(
      (left, right) => promptContextTimestampForSort(left) - promptContextTimestampForSort(right),
    ),
  };
}
