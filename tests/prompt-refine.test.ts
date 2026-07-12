import { describe, expect, it } from "vitest";
import {
  buildPromptRefineMessages,
  cleanRefinedPrompt,
  promptRefineConfig,
} from "@/lib/prompt-refine";

describe("prompt refine core", () => {
  it("yêu cầu giữ nguyên ngôn ngữ gốc, kể cả tiếng Anh và tiếng Trung", () => {
    const messages = buildPromptRefineMessages("一只猫在上海的雨夜", {
      aspectRatio: "3:4",
      resolution: "2K",
    });
    const system = messages[0].content;

    expect(system).toContain("Keep the same language");
    expect(system).toContain("Do not translate");
    expect(messages[1].content).toContain("一只猫在上海的雨夜");
  });

  it("loại bỏ Markdown wrapper nhưng giữ nguyên nội dung prompt", () => {
    expect(cleanRefinedPrompt("```text\nA quiet street at night\n```"))
      .toBe("A quiet street at night");
    expect(cleanRefinedPrompt('"夜晚的上海街道"')).toBe("夜晚的上海街道");
  });

  it("từ chối output rỗng", () => {
    expect(() => cleanRefinedPrompt("```text\n \n```")).toThrow("Prompt cải thiện bị rỗng");
  });

  it("dùng gemini-3-flash-agent làm model mặc định", () => {
    expect(promptRefineConfig({} as NodeJS.ProcessEnv).model).toBe("gemini-3-flash-agent");
  });

  it("thêm hướng dẫn riêng cho edit và video", () => {
    const edit = buildPromptRefineMessages("Đổi áo thành màu đen", { mode: "edit" });
    const video = buildPromptRefineMessages("A boat crossing the ocean", { mode: "video" });
    expect(edit[0].content).toContain("image edit");
    expect(edit[0].content).toContain("unchanged");
    expect(video[0].content).toContain("video generation");
    expect(video[0].content).toContain("motion");
    expect(video[0].content).toContain("consistent across frames");
  });

  it("viết lại prompt ngắn/lủng củng chứ không chỉ sửa nhẹ", () => {
    const system = buildPromptRefineMessages("con mèo").at(0)!.content;
    expect(system).toContain("rewrite");
    expect(system).toContain("expand");
    expect(system).not.toContain("only minimal edits");
  });

  it("có hướng dẫn làm dịu policy và chặn nội dung cấm", () => {
    const system = buildPromptRefineMessages("một cảnh nhạy cảm").at(0)!.content;
    expect(system).toContain("Soften sensitive wording");
    expect(system).toContain("Never include sexual content involving minors");
    expect(system).toContain("jailbreak");
  });

  it("cấm spam tên nghệ sĩ, thương hiệu và quality buzzwords", () => {
    const system = buildPromptRefineMessages("một bức tranh").at(0)!.content;
    expect(system).toContain("Do not add artist names, brand names");
    expect(system).toContain("quality buzzwords");
  });

  it("giữ ý chính, tên, số lượng, màu sắc và ràng buộc của user", () => {
    const system = buildPromptRefineMessages("giữ nguyên ý").at(0)!.content;
    expect(system).toContain("Preserve the core intent");
  });
});
