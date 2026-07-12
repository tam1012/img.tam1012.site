import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("synchronous image generation deployment", () => {
  it("runs image generation directly in the generate API", () => {
    const route = read("src/app/api/generate/route.ts");
    expect(route).toContain("generateImage(provider");
    expect(route).not.toContain("scheduleGenerateJob");
  });

  it("does not deploy a background image worker", () => {
    const compose = read("docker-compose.yml");
    const workflow = read(".github/workflows/deploy.yml");
    expect(compose).not.toMatch(/^  worker:/m);
    expect(workflow).not.toContain("app worker");
    expect(workflow).toContain("docker compose up -d --remove-orphans");
  });

  it("does not leave the generate page polling image jobs", () => {
    const page = read("src/app/generate/page.tsx");
    expect(page).not.toContain("ImageJobStatus");
    expect(page).not.toContain("jobId");
  });
});
