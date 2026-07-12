import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("prompt refine API contract", () => {
  it("cho mọi user đăng nhập, có rate limit và tách khỏi pipeline tạo nội dung", () => {
    const route = readFileSync("src/app/api/prompt-refine/route.ts", "utf8");

    expect(route).toContain("requireUser");
    expect(route).not.toContain("requireAdmin");
    expect(route).toContain("promptRefineRateLimiter.allow(user.id)");
    expect(route).toContain("status: 429");
    expect(route).toContain("refinePrompt");
    expect(route).toContain("Vui lòng nhập mô tả");
    expect(route).not.toContain("generateImage");
    expect(route).not.toContain("debitForImage");
    expect(route).not.toContain("ImageJob");
  });
});
