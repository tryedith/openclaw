import { describe, expect, test } from "vitest";
import { stripEnvelopeFromMessage } from "./chat-sanitize.js";

describe("stripEnvelopeFromMessage", () => {
  test("removes message_id hint lines from user messages", () => {
    const input = {
      role: "user",
      content: "[WhatsApp 2026-01-24 13:36] yolo\n[message_id: 7b8b]",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("yolo");
  });

  test("removes message_id hint lines from text content arrays", () => {
    const input = {
      role: "user",
      content: [{ type: "text", text: "hi\n[message_id: abc123]" }],
    };
    const result = stripEnvelopeFromMessage(input) as {
      content?: Array<{ type: string; text?: string }>;
    };
    expect(result.content?.[0]?.text).toBe("hi");
  });

  test("does not strip inline message_id text that is part of a line", () => {
    const input = {
      role: "user",
      content: "I typed [message_id: 123] on purpose",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("I typed [message_id: 123] on purpose");
  });

  test("does not strip assistant messages", () => {
    const input = {
      role: "assistant",
      content: "note\n[message_id: 123]",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("note\n[message_id: 123]");
  });

  test("strips prepended system event block from user content", () => {
    const input = {
      role: "user",
      content:
        "System: [2026-02-14 19:20:13 UTC] Exec completed (code 0)\nSystem: [2026-02-14 19:20:15 UTC] HTML saved\n\nyeah lets refine image scraping",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("yeah lets refine image scraping");
  });

  test("does not strip single-line user text that starts with System:", () => {
    const input = {
      role: "user",
      content: "System: we should rename this env var",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("System: we should rename this env var");
  });

  test("strips embedded history context marker and keeps current message body", () => {
    const input = {
      role: "user",
      content:
        "[Chat messages since your last reply - for context]\nAlice: prior line\n\n[Current message - respond to this]\nhello\nworld",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("hello\nworld");
  });

  test("strips thread starter marker from user content", () => {
    const input = {
      role: "user",
      content: "[Thread starter - for context]\ninitial task detail",
    };
    const result = stripEnvelopeFromMessage(input) as { content?: string };
    expect(result.content).toBe("initial task detail");
  });
});
