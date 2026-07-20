/**
 * Reauth Flow account từ Chromium user-data-dir trên VPS.
 * Bắt storageState → mã hoá public key bridge → docker exec apply-enrollment.
 *
 * Usage: node reauth-from-profile.mjs flow-02
 */
import { spawn } from "node:child_process";
import {
  createCipheriv,
  constants as cryptoConstants,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(join(here, "flow-profiles.json"), "utf8"));

const FLOW_URL = "https://labs.google/fx/tools/flow";
const SESSION_ENDPOINT = "/fx/api/auth/session";
const AISANDBOX_SCOPE = "https://www.googleapis.com/auth/aisandbox";
const LOGIN_TIMEOUT_MS = Number(process.env.FLOW_LOGIN_TIMEOUT_MS || 3 * 60_000);

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function resolveAccount(key) {
  const k = String(key || "").trim().toLowerCase();
  if (/^\d+$/.test(k)) {
    const i = Number(k);
    if (i >= 1 && i <= map.accounts.length) return map.accounts[i - 1];
  }
  return (
    map.accounts.find(
      (a) =>
        a.alias.toLowerCase() === k ||
        a.email.toLowerCase() === k ||
        a.folder.toLowerCase() === k,
    ) || null
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        server.close(() => resolve(port));
      } else server.close(() => reject(new Error("no port")));
    });
  });
}

function encryptEnrollment(payload, publicKeyPem) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt(
    { key: publicKeyPem, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    key,
  );
  return {
    version: 1,
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

async function readSessionSummary(page) {
  return page.evaluate(
    async ([endpoint, scope]) => {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) return { authenticated: false, hasAisandbox: false };
      const session = await res.json();
      const token = session?.access_token;
      if (!token) return { authenticated: false, hasAisandbox: false };
      let hasAisandbox = false;
      try {
        const info = await fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`,
        );
        if (info.ok) {
          const data = await info.json();
          hasAisandbox =
            typeof data.scope === "string" && data.scope.split(/\s+/).includes(scope);
        }
      } catch {
        hasAisandbox = false;
      }
      return { authenticated: true, hasAisandbox };
    },
    [SESSION_ENDPOINT, AISANDBOX_SCOPE],
  );
}

async function readAccountEmail(page) {
  return page
    .evaluate(async ([endpoint]) => {
      try {
        const res = await fetch(endpoint, { credentials: "include" });
        if (!res.ok) return null;
        const session = await res.json();
        if (session?.user?.email) return session.user.email;
        if (session?.email) return session.email;
        const token = session?.access_token;
        if (token) {
          const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (info.ok) {
            const data = await info.json();
            if (data?.email) return data.email;
          }
        }
      } catch {
        return null;
      }
      return null;
    }, [SESSION_ENDPOINT])
    .catch(() => null);
}

async function waitSession(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  for (;;) {
    let summary = { authenticated: false, hasAisandbox: false };
    try {
      summary = await readSessionSummary(page);
    } catch {
      /* nav */
    }
    if (summary.authenticated && summary.hasAisandbox) return summary;
    if (Date.now() - last > 10_000) {
      last = Date.now();
      log(
        `Cho session... url=${page.url()} auth=${summary.authenticated} aisandbox=${summary.hasAisandbox}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Het thoi gian cho session Flow. Chay open-profile.sh ${process.argv[2] || ""} login tay qua Guacamole, roi chay lai reauth.`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} exit ${code}: ${err || out}`.slice(0, 500)));
    });
  });
}

async function main() {
  const key = process.argv[2];
  const acc = resolveAccount(key);
  if (!acc) {
    log("Usage: node reauth-from-profile.mjs <flow-01|1-5|email>");
    log("Accounts: " + map.accounts.map((a) => a.alias).join(", "));
    process.exit(1);
  }

  const userDataDir = join(map.profilesRoot, acc.folder);
  mkdirSync(userDataDir, { recursive: true });
  if (!existsSync(map.publicKeyFile)) {
    throw new Error(`Thieu public key: ${map.publicKeyFile}`);
  }
  if (!existsSync(map.applyScript)) {
    throw new Error(`Thieu apply script: ${map.applyScript}`);
  }
  if (!existsSync(map.chromiumPath)) {
    throw new Error(`Thieu chromium: ${map.chromiumPath}`);
  }

  log(`Reauth ${acc.alias} <${acc.email}>`);
  log(`user-data-dir: ${userDataDir}`);

  const port = await freePort();
  const chrome = spawn(
    map.chromiumPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--password-store=basic",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Headless new vẫn đọc cookie profile; GUI login dung open-profile.sh
      "--headless=new",
      FLOW_URL,
    ],
    { stdio: "ignore", detached: false },
  );

  let browser;
  try {
    const deadline = Date.now() + 60_000;
    while (!browser) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      } catch (e) {
        if (Date.now() > deadline) {
          throw new Error(
            `Khong ket noi CDP. Profile dang bi khoa (Chromium con mo)? ${e instanceof Error ? e.message : e}`,
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const context = browser.contexts()[0] ?? (await browser.newContext());
    let page =
      context.pages().find((p) => p.url().includes("labs.google")) ?? context.pages()[0];
    if (!page) page = await context.newPage();
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2000));

    await waitSession(page, LOGIN_TIMEOUT_MS);
    const email = await readAccountEmail(page);
    if (!email) throw new Error("Khong doc duoc email tu session");
    if (email.toLowerCase() !== acc.email.toLowerCase()) {
      throw new Error(
        `Email session la ${email}, khac map ${acc.email} — dung, khong day nham account`,
      );
    }

    const storageState = await context.storageState({ indexedDB: true });
    const payload = {
      version: 1,
      issuedAt: new Date().toISOString(),
      storageState: { cookies: storageState.cookies, origins: storageState.origins },
      email,
    };
    const publicKeyPem = readFileSync(map.publicKeyFile, "utf8");
    const encrypted = encryptEnrollment(payload, publicKeyPem);
    log(`Bat session OK (${email}, cookies=${storageState.cookies.length})`);

    const bundlePath = join(tmpdir(), `flow-enroll-${acc.alias}-${Date.now()}.json`);
    writeFileSync(bundlePath, JSON.stringify(encrypted), { mode: 0o600 });
    const remoteBundle = `/tmp/flow-enroll-${acc.alias}-${Date.now()}.json`;
    const remoteApply = `/tmp/flow-apply-${acc.alias}-${Date.now()}.cjs`;

    try {
      await run("docker", ["cp", bundlePath, `${map.container}:${remoteBundle}`]);
      await run("docker", ["cp", map.applyScript, `${map.container}:${remoteApply}`]);
      const { out } = await run("docker", [
        "exec",
        map.container,
        "node",
        remoteApply,
        remoteBundle,
      ]);
      await run("docker", [
        "exec",
        map.container,
        "rm",
        "-f",
        remoteBundle,
        remoteApply,
      ]).catch(() => undefined);

      const line = out.trim().split("\n").pop() || "{}";
      let result = {};
      try {
        result = JSON.parse(line);
      } catch {
        throw new Error(`Phan hoi bridge khong phai JSON: ${line.slice(0, 200)}`);
      }
      if (!result.ok) throw new Error(result.error || "apply that bai");
      process.stdout.write(
        `\nXONG — ${result.action === "reauth" ? "Dang nhap lai" : "Them moi"}\n` +
          `  Email:      ${result.email || email}\n` +
          `  Nhan:       ${result.alias || acc.alias}\n` +
          `  Trang thai: ${result.status || "?"}\n`,
      );
    } finally {
      try {
        rmSync(bundlePath, { force: true });
      } catch {
        /* ignore */
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (chrome && !chrome.killed) {
      try {
        chrome.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((e) => {
  log(`THAT BAI: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
