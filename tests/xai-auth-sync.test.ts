import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xai-sync-"));
  roots.push(root);
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  return { source, target };
}

function runSync(source: string, target: string) {
  return spawnSync("python", ["scripts/sync-xai-auth-pool.py"], {
    cwd: process.cwd(),
    env: { ...process.env, XAI_AUTH_SOURCE_DIR: source, XAI_AUTH_TARGET_DIR: target },
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("xAI auth sync", () => {
  it("chỉ copy account xAI và đặt tên vô danh", () => {
    const { source, target } = setup();
    fs.writeFileSync(path.join(source, "xai-user-one.json"), JSON.stringify({ access_token: "one" }));
    fs.writeFileSync(path.join(source, "codex-user.json"), JSON.stringify({ access_token: "secret" }));

    const result = runSync(source, target);

    expect(result.status).toBe(0);
    expect(fs.readdirSync(target).filter((name) => name.endsWith(".json"))).toEqual(["xai-01.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(target, "xai-01.json"), "utf8")).access_token).toBe("one");
    expect(result.stdout).toContain("accounts=1");
    expect(result.stdout).not.toContain("user-one");
  });

  it("tự cập nhật token, thêm account và xóa account không còn trong CPA", () => {
    const { source, target } = setup();
    fs.writeFileSync(path.join(source, "xai-a.json"), JSON.stringify({ access_token: "old" }));
    expect(runSync(source, target).status).toBe(0);

    fs.writeFileSync(path.join(source, "xai-a.json"), JSON.stringify({ access_token: "new" }));
    fs.writeFileSync(path.join(source, "xai-b.json"), JSON.stringify({ access_token: "second" }));
    expect(runSync(source, target).status).toBe(0);
    expect(fs.readdirSync(target).filter((name) => name.endsWith(".json"))).toEqual(["xai-01.json", "xai-02.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(target, "xai-01.json"), "utf8")).access_token).toBe("new");

    fs.rmSync(path.join(source, "xai-a.json"));
    expect(runSync(source, target).status).toBe(0);
    expect(fs.readdirSync(target).filter((name) => name.endsWith(".json"))).toEqual(["xai-01.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(target, "xai-01.json"), "utf8")).access_token).toBe("second");
  });

  it("không ghi lại file khi nội dung OAuth không thay đổi", () => {
    const { source, target } = setup();
    fs.writeFileSync(path.join(source, "xai-a.json"), JSON.stringify({ access_token: "stable" }));
    expect(runSync(source, target).status).toBe(0);
    const targetFile = path.join(target, "xai-01.json");
    const before = fs.statSync(targetFile);

    expect(runSync(source, target).status).toBe(0);
    const after = fs.statSync(targetFile);

    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
