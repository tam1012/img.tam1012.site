import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { XaiAuthPool, runWithXaiAccount } from "@/lib/xai-auth-pool";

const dirs: string[] = [];

function authDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xai-pool-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "account-b.json"), JSON.stringify({ access_token: "token-b" }));
  fs.writeFileSync(path.join(dir, "account-a.json"), JSON.stringify({ access_token: "token-a" }));
  fs.writeFileSync(path.join(dir, "invalid.json"), JSON.stringify({ refresh_token: "hidden" }));
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("XaiAuthPool", () => {
  it("phát hiện account hợp lệ và chỉ trả ID vô danh", () => {
    const pool = new XaiAuthPool(authDir());
    const accounts = pool.listAccounts();

    expect(accounts.map((account) => account.id)).toEqual(["xai-01", "xai-02"]);
    expect(accounts.map((account) => account.apiKey)).toEqual(["token-a", "token-b"]);
    expect(accounts.every((account) => !account.id.includes("account"))).toBe(true);
  });

  it("chọn account round-robin", () => {
    const pool = new XaiAuthPool(authDir());
    expect(pool.acquire().id).toBe("xai-01");
    expect(pool.acquire().id).toBe("xai-02");
    expect(pool.acquire().id).toBe("xai-01");
  });

  it("bỏ qua account đang cooldown", () => {
    const pool = new XaiAuthPool(authDir());
    const first = pool.acquire();
    pool.markCooldown(first, 60_000);

    expect(pool.acquire().id).toBe("xai-02");
  });

  it("reload token mới từ đúng file của account", () => {
    const dir = authDir();
    const pool = new XaiAuthPool(dir);
    const account = pool.acquire();
    fs.writeFileSync(account.path, JSON.stringify({ access_token: "token-refreshed" }));

    expect(pool.reload(account).apiKey).toBe("token-refreshed");
    expect(pool.reload(account).id).toBe(account.id);
  });

  it("chuyển sang account tiếp theo khi account đầu bị quota", async () => {
    const pool = new XaiAuthPool(authDir());
    const attempted: string[] = [];
    const result = await runWithXaiAccount(pool, async (account) => {
      attempted.push(account.id);
      if (account.id === "xai-01") throw Object.assign(new Error("quota exceeded"), { status: 429 });
      return "ok";
    });

    expect(result.value).toBe("ok");
    expect(result.account.id).toBe("xai-02");
    expect(attempted).toEqual(["xai-01", "xai-02"]);
  });
});
