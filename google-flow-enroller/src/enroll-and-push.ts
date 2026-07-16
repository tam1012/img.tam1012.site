import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { captureFlowSession } from "./probes/export-session.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const enrollerRoot = join(here, "..");
const repoRoot = join(enrollerRoot, "..");

type Config = {
  host: string;
  user: string;
  sshKey: string;
  container: string;
  publicKeyFile: string;
  applyScript: string;
};

// Hạ tầng hiện tại; đè bằng enroll.config.json nếu cần. KHÔNG chứa admin key.
function loadConfig(): Config {
  const defaults: Config = {
    host: "158.178.239.119",
    user: "ubuntu",
    sshKey: "C:\\Users\\Ha Tam\\.ssh\\ssh-key-2026-04-20_tamhvt.key",
    container: "google-media-bridge",
    publicKeyFile: join(enrollerRoot, "state", "probe-public.pem"),
    applyScript: join(repoRoot, "google-media-bridge", "scripts", "apply-enrollment.cjs"),
  };
  const cfgPath = join(enrollerRoot, "enroll.config.json");
  if (existsSync(cfgPath)) {
    try {
      const override = JSON.parse(readFileSync(cfgPath, "utf8")) as Partial<Config>;
      return { ...defaults, ...override };
    } catch {
      log("(không đọc được enroll.config.json, dùng mặc định)");
    }
  }
  return defaults;
}

function log(message: string) {
  process.stderr.write(`${message}\n`);
}

function sshBase(cfg: Config): string[] {
  return ["-i", cfg.sshKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20"];
}

async function scp(cfg: Config, localPath: string, remotePath: string): Promise<void> {
  await execFileAsync("scp", [...sshBase(cfg), localPath, `${cfg.user}@${cfg.host}:${remotePath}`], {
    windowsHide: true,
  });
}

async function ssh(cfg: Config, remoteCommand: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "ssh",
    [...sshBase(cfg), `${cfg.user}@${cfg.host}`, remoteCommand],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout;
}

async function main() {
  const cfg = loadConfig();
  if (!existsSync(cfg.publicKeyFile)) {
    throw new Error(`Thiếu public key: ${cfg.publicKeyFile}`);
  }
  if (!existsSync(cfg.applyScript)) {
    throw new Error(`Thiếu apply script: ${cfg.applyScript}`);
  }

  // 1) Đăng nhập Flow + bắt session/email, mã hoá trong bộ nhớ.
  const { encrypted, email } = await captureFlowSession({
    publicKeyFile: cfg.publicKeyFile,
    onLog: log,
  });
  log(`Đã bắt session Flow (email: ${email ?? "không đọc được"}). Đang đẩy lên VPS...`);

  // 2) Ghi bundle mã hoá ra file tạm local rồi scp lên VPS.
  const localTmp = await mkdtemp(join(tmpdir(), "flow-push-"));
  const localBundle = join(localTmp, "bundle.json");
  await writeFile(localBundle, JSON.stringify(encrypted), { mode: 0o600 });

  const tag = randomUUID();
  const remoteBundle = `/tmp/flow-enroll-${tag}.json`;
  const remoteApply = `/tmp/flow-apply-${tag}.cjs`;

  try {
    await scp(cfg, localBundle, remoteBundle);
    await scp(cfg, cfg.applyScript, remoteApply);

    // 3) docker cp vào container + chạy apply (đọc admin key từ env container) + dọn.
    const c = cfg.container;
    const remoteCmd =
      `docker cp ${remoteBundle} ${c}:${remoteBundle} >/dev/null 2>&1 || { echo '{"ok":false,"error":"docker cp bundle"}'; exit 1; }; ` +
      `docker cp ${remoteApply} ${c}:${remoteApply} >/dev/null 2>&1 || { echo '{"ok":false,"error":"docker cp apply"}'; exit 1; }; ` +
      `OUT=$(docker exec ${c} node ${remoteApply} ${remoteBundle}); RC=$?; ` +
      `docker exec ${c} rm -f ${remoteBundle} ${remoteApply} >/dev/null 2>&1 || true; ` +
      `rm -f ${remoteBundle} ${remoteApply}; ` +
      `echo "$OUT"; exit $RC`;

    const out = await ssh(cfg, remoteCmd);
    const line = out.trim().split("\n").pop() || "{}";
    let result: {
      ok?: boolean;
      action?: string;
      alias?: string;
      email?: string;
      status?: string;
      error?: string;
    } = {};
    try {
      result = JSON.parse(line);
    } catch {
      throw new Error(`Không phân tích được phản hồi từ VPS: ${line.slice(0, 200)}`);
    }

    if (!result.ok) throw new Error(result.error || "apply thất bại");

    const actionLabel = result.action === "reauth" ? "Đăng nhập lại" : "Thêm mới";
    process.stdout.write(
      `\nXONG — ${actionLabel} tài khoản\n` +
        `  Email:   ${result.email ?? "(không có)"}\n` +
        `  Nhãn:    ${result.alias ?? "?"}\n` +
        `  Trạng thái: ${result.status ?? "?"}\n`,
    );
  } finally {
    await rm(localTmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  log(`THẤT BẠI: ${error instanceof Error ? error.message : "lỗi không rõ"}`);
  process.exitCode = 1;
});
