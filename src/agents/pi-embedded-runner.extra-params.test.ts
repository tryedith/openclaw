import { describe, expect, it } from "vitest";

import {
  applyAnthropicCacheControlTtl,
  resolveCacheRetention,
} from "./pi-embedded-runner/extra-params.js";

describe("resolveCacheRetention", () => {
  it("maps anthropic cacheControlTtl=1h to cacheRetention=long", () => {
    const result = resolveCacheRetention({ cacheControlTtl: "1h" }, "anthropic", "claude-opus-4-5");
    expect(result).toBe("long");
  });

  it("maps anthropic cacheControlTtl=5m to cacheRetention=short", () => {
    const result = resolveCacheRetention(
      { cacheControlTtl: "5m" },
      "anthropic",
      "claude-sonnet-4-5",
    );
    expect(result).toBe("short");
  });

  it("maps openrouter anthropic/* cacheControlTtl to cacheRetention", () => {
    const result = resolveCacheRetention(
      { cacheControlTtl: "1h" },
      "openrouter",
      "anthropic/claude-opus-4-5",
    );
    expect(result).toBe("long");
  });

  it("does not set cacheRetention for non-anthropic providers", () => {
    const result = resolveCacheRetention({ cacheControlTtl: "1h" }, "openai", "gpt-5");
    expect(result).toBeUndefined();
  });

  it("ignores invalid cacheControlTtl values", () => {
    const result = resolveCacheRetention({ cacheControlTtl: "2h" }, "anthropic", "claude-opus-4-5");
    expect(result).toBeUndefined();
  });
});

describe("applyAnthropicCacheControlTtl", () => {
  it("adds ttl=1h to system and last user cache_control blocks", () => {
    const payload = {
      system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "assistant", content: [{ type: "text", text: "a" }] },
        {
          role: "user",
          content: [{ type: "text", text: "u", cache_control: { type: "ephemeral" } }],
        },
      ],
    } as Record<string, unknown>;

    applyAnthropicCacheControlTtl(payload, "1h");

    const system = payload.system as Array<Record<string, unknown>>;
    const messages = payload.messages as Array<Record<string, unknown>>;
    const userContent = messages[1].content as Array<Record<string, unknown>>;
    expect(system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(userContent[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("leaves payload unchanged for 5m", () => {
    const payload = {
      system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "hello" }],
    } as Record<string, unknown>;

    applyAnthropicCacheControlTtl(payload, "5m");

    const system = payload.system as Array<Record<string, unknown>>;
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect((payload.messages as Array<Record<string, unknown>>)[0].content).toBe("hello");
  });
});
