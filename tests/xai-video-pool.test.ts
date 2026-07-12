import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("xAI video OAuth pool", () => {
  it("chọn account từ pool một lần và giữ nguyên cho create/poll", () => {
    const source = readFileSync("src/lib/video.ts", "utf8");
    const branch = source.slice(
      source.indexOf("async function generateXaiVideo"),
      source.indexOf("export async function generateVideo"),
    );

    expect(source).toContain('from "./xai-auth-pool"');
    expect(branch).toContain("runWithXaiAccount(xaiAuthPool");
    expect(branch).toContain("account.apiKey");
    expect(branch).toContain("account.id");
    expect(branch).not.toContain("getXaiApiKey");
    expect(branch.match(/runWithXaiAccount\(xaiAuthPool/g)).toHaveLength(1);
  });
});
