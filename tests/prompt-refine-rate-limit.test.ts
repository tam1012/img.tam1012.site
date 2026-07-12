import { describe, expect, it } from "vitest";
import { PromptRefineRateLimiter } from "@/lib/prompt-refine-rate-limit";

describe("PromptRefineRateLimiter", () => {
  it("cho tối đa 10 request mỗi phút cho từng user", () => {
    let now = 1_000;
    const limiter = new PromptRefineRateLimiter(10, 60_000, () => now);
    for (let i = 0; i < 10; i++) expect(limiter.allow("user-a")).toBe(true);
    expect(limiter.allow("user-a")).toBe(false);
    expect(limiter.allow("user-b")).toBe(true);
    now += 60_001;
    expect(limiter.allow("user-a")).toBe(true);
  });
});
