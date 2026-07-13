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

  it("Grok edit gửi application/json direct, không dùng OpenAI multipart images.edit", () => {
    const source = readFileSync("src/lib/providers/custom.ts", "utf8");
    const editFn = source.slice(
      source.indexOf("async function grokDirectEdit"),
      source.indexOf("async function chatCompletionsGenerate"),
    );

    expect(editFn).toContain('`${XAI_BASE_URL}/images/edits`');
    expect(editFn).toContain('"Content-Type": "application/json"');
    expect(editFn).toContain("Authorization: `Bearer ${selected.apiKey}`");
    expect(editFn).toContain('type: "image_url"');
    expect(editFn).toContain("data:${mimeType};base64,");
    expect(editFn).toContain('params.resolution === "4K" ? "2k"');
    expect(editFn).toContain("aspect_ratio: params.aspectRatio");
    expect(editFn).toContain("buildImageInstructionPrefix");
    expect(editFn).toContain("extractOpenAIImage");
    expect(editFn).not.toContain("client.images.edit");
    expect(editFn).not.toContain("toFile");
    expect(editFn).not.toContain("new OpenAI");
  });
});
