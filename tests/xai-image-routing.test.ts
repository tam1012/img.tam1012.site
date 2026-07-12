import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("direct xAI image routing", () => {
  it("route Grok Image qua api.x.ai và OAuth pool thay vì CPA provider base URL", () => {
    const source = readFileSync("src/lib/providers/custom.ts", "utf8");
    const grokBranch = source.slice(
      source.indexOf("async function grokDirectGenerate"),
      source.indexOf("async function chatCompletionsGenerate"),
    );

    expect(source).toContain('from "../xai-auth-pool"');
    expect(source).toContain("grokDirectGenerate(config.model, params)");
    expect(source).toContain("grokDirectEdit(config.model, params)");
    expect(grokBranch).toContain("XAI_BASE_URL");
    expect(grokBranch).toContain("runWithXaiAccount");
    expect(grokBranch).not.toContain("config.base_url");
  });
});
