import { describe, expect, it } from "vitest";

import { replaceMemoryFlushTurnsWithNotice } from "./chat.js";

describe("replaceMemoryFlushTurnsWithNotice", () => {
  it("replaces memory flush prompt + NO_REPLY pair with a system notice", () => {
    const input: Record<string, unknown>[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Pre-compaction memory flush. Store durable memories now." },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
        timestamp: 1234,
      },
    ];

    const result = replaceMemoryFlushTurnsWithNotice(
      input,
      "Pre-compaction memory flush. Store durable memories now.",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "system",
      content: [{ type: "text", text: "Memory maintenance run completed." }],
      timestamp: 1234,
    });
  });

  it("leaves non-matching turns unchanged", () => {
    const input: Record<string, unknown>[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "world" }] },
    ];

    expect(replaceMemoryFlushTurnsWithNotice(input, "Pre-compaction memory flush")).toEqual(input);
  });
});
