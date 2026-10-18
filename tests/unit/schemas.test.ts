import { describe, expect, it } from "vitest";
import { CheckRequestSchema } from "../../shared/schemas";
import { rateLimited, resetRateLimit } from "../../server/ratelimit";

const base = () => ({
  image: "abc",
  segments: [{ tag: 1, key: "1", hasNew: true, announced: false, vetoed: false }],
  crops: { "1": "def" },
  lastIssue: "",
  persona: "friendly",
});

describe("CheckRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(CheckRequestSchema.safeParse(base()).success).toBe(true);
  });
  it("rejects an unknown persona", () => {
    expect(CheckRequestSchema.safeParse({ ...base(), persona: "pirate" }).success).toBe(false);
  });
  it("rejects empty segments", () => {
    expect(CheckRequestSchema.safeParse({ ...base(), segments: [] }).success).toBe(false);
  });
  it("rejects oversized fields", () => {
    expect(CheckRequestSchema.safeParse({ ...base(), image: "a".repeat(3_000_001) }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ ...base(), lastIssue: "a".repeat(601) }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ ...base(), crops: { "1": "a".repeat(1_500_001) } }).success).toBe(false);
  });
  it("rejects more than 12 crops and more than 80 segments", () => {
    const crops = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(i), "x"]));
    expect(CheckRequestSchema.safeParse({ ...base(), crops }).success).toBe(false);
    const seg = base().segments[0];
    expect(CheckRequestSchema.safeParse({ ...base(), segments: Array.from({ length: 81 }, (_, i) => ({ ...seg, tag: i + 1 })) }).success).toBe(false);
  });
  it("rejects a missing field", () => {
    const { image: _image, ...rest } = base();
    void _image;
    expect(CheckRequestSchema.safeParse(rest).success).toBe(false);
  });
});

describe("rate limit", () => {
  it("allows 30 requests per minute per ip, then blocks", () => {
    resetRateLimit();
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) expect(rateLimited("ip", 30, 60_000, t + i)).toBe(false);
    expect(rateLimited("ip", 30, 60_000, t + 31)).toBe(true);
    expect(rateLimited("other", 30, 60_000, t + 31)).toBe(false);
    expect(rateLimited("ip", 30, 60_000, t + 61_000)).toBe(false);
  });
});
