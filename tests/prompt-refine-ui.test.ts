import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin prompt refine UI", () => {
  it("Generate dùng component refine chung cho mọi user", () => {
    const page = readFileSync("src/app/generate/page.tsx", "utf8");

    expect(page).toContain('import PromptRefineControls from "@/components/PromptRefineControls"');
    expect(page).toContain('<PromptRefineControls');
    expect(page).toContain('mode="generate"');
    expect(page).not.toContain('me?.user.role === "admin"');
  });

  it("không đưa refine flag vào request tạo ảnh", () => {
    const page = readFileSync("src/app/generate/page.tsx", "utf8");
    expect(page).not.toContain("refine_prompt");
    expect(page).not.toContain("refine_model");
  });
});
