import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("xAI OAuth mounts", () => {
  it("mount thư mục pool động read-only để add/remove account không cần restart", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose).toContain("./secrets/xai-auths:/run/secrets/xai-auths:ro");
    expect(compose).toContain("XAI_AUTH_DIR=/run/secrets/xai-auths");
  });
});
