import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production app port publishing", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");

  it("chỉ publish Next.js port trên localhost cho nginx", () => {
    expect(compose).toContain("127.0.0.1:3456:3456");
    expect(compose).not.toMatch(/^\s*-\s*["']?3456:3456["']?\s*$/m);
    expect(compose).not.toContain("0.0.0.0:3456:3456");
  });
});
