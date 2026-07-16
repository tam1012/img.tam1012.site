import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const enrollerRoot = join(here, "..");
const repoRoot = join(enrollerRoot, "..");

type Config = {
  host: string;
  user: string;
  sshKey: string;
  container: string;
  listScript: string;
};

function loadConfig(): Config {
  const defaults: Config = {
    host: "158.178.239.119",
    user: "ubuntu",
    sshKey: "C:\\Users\\Ha Tam\\.ssh\\ssh-key-2026-04-20_tamhvt.key",
    container: "google-media-bridge",
    listScript: join(repoRoot, "google-media-bridge", "scripts", "list-accounts.cjs"),
  };
  const cfgPath = join(enrollerRoot, "enroll.config.json");
  if (existsSync(cfgPath)) {
    try {
      return { ...defaults, ...(JSON.parse(readFileSync(cfgPath, "utf8")) as Partial<Config>) };
    } catch {
      /* dùng mặc định */
    }
  }
  return defaults;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function main() {
  const cfg = loadConfig();
  const sshBase = ["-i", cfg.sshKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20"];
  const tag = randomUUID();
  const remoteList = `/tmp/flow-list-${tag}.cjs`;

  await execFileAsync("scp", [...sshBase, cfg.listScript, `${cfg.user}@${cfg.host}:${remoteList}`], {
    windowsHide: true,
  });

  const c = cfg.container;
  const cmd =
    `docker cp ${remoteList} ${c}:${remoteList} >/dev/null 2>&1; ` +
    `OUT=$(docker exec ${c} node ${remoteList}); ` +
    `docker exec ${c} rm -f ${remoteList} >/dev/null 2>&1 || true; ` +
    `rm -f ${remoteList}; echo "$OUT"`;

  const { stdout } = await execFileAsync("ssh", [...sshBase, `${cfg.user}@${cfg.host}`, cmd], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  const line = stdout.trim().split("\n").pop() || "{}";
  const parsed = JSON.parse(line) as {
    accounts?: Array<{
      alias: string;
      email: string | null;
      status: string;
      lastUsedAt: string | null;
      failureCode: string | null;
    }>;
    error?: string;
  };
  if (parsed.error) throw new Error(parsed.error);
  const accounts = parsed.accounts ?? [];
  if (accounts.length === 0) {
    process.stdout.write("Chưa có tài khoản Flow nào.\n");
    return;
  }

  const rows = accounts.map((a) => ({
    email: a.email || "(chưa có email)",
    alias: a.alias,
    status: a.status,
    lastUsed: a.lastUsedAt ? a.lastUsedAt.replace("T", " ").slice(0, 16) : "-",
    failure: a.failureCode || "-",
  }));
  const w = {
    email: Math.max(5, ...rows.map((r) => r.email.length)),
    alias: Math.max(5, ...rows.map((r) => r.alias.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    lastUsed: Math.max(9, ...rows.map((r) => r.lastUsed.length)),
  };
  const header =
    `${pad("EMAIL", w.email)}  ${pad("NHÃN", w.alias)}  ${pad("TRẠNG THÁI", w.status)}  ${pad("DÙNG GẦN NHẤT", w.lastUsed)}  LỖI`;
  process.stdout.write(header + "\n");
  process.stdout.write("-".repeat(header.length) + "\n");
  for (const r of rows) {
    process.stdout.write(
      `${pad(r.email, w.email)}  ${pad(r.alias, w.alias)}  ${pad(r.status, w.status)}  ${pad(r.lastUsed, w.lastUsed)}  ${r.failure}\n`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`THẤT BẠI: ${error instanceof Error ? error.message : "lỗi không rõ"}\n`);
  process.exitCode = 1;
});
