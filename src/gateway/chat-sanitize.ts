import { stripEnvelope, stripMessageIdHints } from "../shared/chat-envelope.js";

export { stripEnvelope };

const SYSTEM_EVENT_LINE_RE = /^System:\s*\[[^\]]+\]\s+.+$/;
const HISTORY_CONTEXT_MARKER = "[Chat messages since your last reply - for context]";
const CURRENT_MESSAGE_MARKER = "[Current message - respond to this]";
const THREAD_STARTER_MARKER = "[Thread starter - for context]";
const THREAD_HISTORY_MARKER = "[Thread history - for context]";

function stripPrependedSystemEventBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && SYSTEM_EVENT_LINE_RE.test(lines[i]?.trim() ?? "")) {
    i += 1;
  }
  if (i === 0) {
    return text;
  }
  while (i < lines.length && lines[i]?.trim() === "") {
    i += 1;
  }
  const stripped = lines.slice(i).join("\n").trimStart();
  return stripped.length > 0 ? stripped : text;
}

function stripStructuredHistoryWrappers(text: string): string {
  if (text.includes(CURRENT_MESSAGE_MARKER)) {
    const idx = text.indexOf(CURRENT_MESSAGE_MARKER);
    const stripped = text.slice(idx + CURRENT_MESSAGE_MARKER.length).trimStart();
    return stripped.length > 0 ? stripped : text;
  }
  if (text.startsWith(`${THREAD_STARTER_MARKER}\n`)) {
    const stripped = text.slice(THREAD_STARTER_MARKER.length).trimStart();
    return stripped.length > 0 ? stripped : text;
  }
  if (text.startsWith(`${THREAD_HISTORY_MARKER}\n`)) {
    const stripped = text.slice(THREAD_HISTORY_MARKER.length).trimStart();
    return stripped.length > 0 ? stripped : text;
  }
  if (text.startsWith(`${HISTORY_CONTEXT_MARKER}\n`)) {
    const stripped = text.slice(HISTORY_CONTEXT_MARKER.length).trimStart();
    return stripped.length > 0 ? stripped : text;
  }
  return text;
}

function sanitizeUserVisibleUserText(text: string): string {
  const noEnvelope = stripMessageIdHints(stripEnvelope(text));
  const noSystemBlock = stripPrependedSystemEventBlock(noEnvelope);
  return stripStructuredHistoryWrappers(noSystemBlock);
}

function stripEnvelopeFromContent(content: unknown[]): { content: unknown[]; changed: boolean } {
  let changed = false;
  const next = content.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const entry = item as Record<string, unknown>;
    if (entry.type !== "text" || typeof entry.text !== "string") {
      return item;
    }
    const stripped = sanitizeUserVisibleUserText(entry.text);
    if (stripped === entry.text) {
      return item;
    }
    changed = true;
    return {
      ...entry,
      text: stripped,
    };
  });
  return { content: next, changed };
}

export function stripEnvelopeFromMessage(message: unknown): unknown {
  if (!message || typeof message !== "object") {
    return message;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "user") {
    return message;
  }

  let changed = false;
  const next: Record<string, unknown> = { ...entry };

  if (typeof entry.content === "string") {
    const stripped = sanitizeUserVisibleUserText(entry.content);
    if (stripped !== entry.content) {
      next.content = stripped;
      changed = true;
    }
  } else if (Array.isArray(entry.content)) {
    const updated = stripEnvelopeFromContent(entry.content);
    if (updated.changed) {
      next.content = updated.content;
      changed = true;
    }
  } else if (typeof entry.text === "string") {
    const stripped = sanitizeUserVisibleUserText(entry.text);
    if (stripped !== entry.text) {
      next.text = stripped;
      changed = true;
    }
  }

  return changed ? next : message;
}

export function stripEnvelopeFromMessages(messages: unknown[]): unknown[] {
  if (messages.length === 0) {
    return messages;
  }
  let changed = false;
  const next = messages.map((message) => {
    const stripped = stripEnvelopeFromMessage(message);
    if (stripped !== message) {
      changed = true;
    }
    return stripped;
  });
  return changed ? next : messages;
}
