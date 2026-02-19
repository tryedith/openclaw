import { stripEnvelope, stripMessageIdHints } from "../shared/chat-envelope.js";

export { stripEnvelope };

const SYSTEM_EVENT_LINE = /^\s*System:\s+/;
const HISTORY_CONTEXT_MARKER = "[Chat messages since your last reply - for context]";
const CURRENT_MESSAGE_MARKER = "[Current message - respond to this]";
const THREAD_STARTER_MARKER = "[Thread starter - for context]";

function stripPrependedSystemEventBlock(text: string): string {
  if (!text.startsWith("System:")) {
    return text;
  }
  const lines = text.split(/\r?\n/);
  let idx = 0;
  while (idx < lines.length && SYSTEM_EVENT_LINE.test(lines[idx] ?? "")) {
    idx += 1;
  }
  if (idx === 0 || idx >= lines.length || (lines[idx] ?? "").trim().length !== 0) {
    return text;
  }
  while (idx < lines.length && (lines[idx] ?? "").trim().length === 0) {
    idx += 1;
  }
  if (idx >= lines.length) {
    return text;
  }
  return lines.slice(idx).join("\n");
}

function stripEmbeddedHistoryContext(text: string): string {
  const currentIdx = text.indexOf(CURRENT_MESSAGE_MARKER);
  if (currentIdx >= 0) {
    return text.slice(currentIdx + CURRENT_MESSAGE_MARKER.length).trimStart();
  }
  if (text.startsWith(HISTORY_CONTEXT_MARKER)) {
    const lines = text.split(/\r?\n/);
    // Marker-only context with no explicit current-message section: keep the tail block.
    let idx = 1;
    while (idx < lines.length && (lines[idx] ?? "").trim().length === 0) {
      idx += 1;
    }
    return idx < lines.length ? lines.slice(idx).join("\n") : text;
  }
  if (text.startsWith(THREAD_STARTER_MARKER)) {
    const lines = text.split(/\r?\n/);
    let idx = 1;
    while (idx < lines.length && (lines[idx] ?? "").trim().length === 0) {
      idx += 1;
    }
    return idx < lines.length ? lines.slice(idx).join("\n") : text;
  }
  return text;
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
    const stripped = stripEmbeddedHistoryContext(
      stripPrependedSystemEventBlock(stripMessageIdHints(stripEnvelope(entry.text))),
    );
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
    const stripped = stripEmbeddedHistoryContext(
      stripPrependedSystemEventBlock(stripMessageIdHints(stripEnvelope(entry.content))),
    );
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
    const stripped = stripEmbeddedHistoryContext(
      stripPrependedSystemEventBlock(stripMessageIdHints(stripEnvelope(entry.text))),
    );
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
