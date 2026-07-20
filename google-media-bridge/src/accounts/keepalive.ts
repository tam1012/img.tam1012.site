import type { AccountRepository } from "./repository.js";
import type { BrowserWorkerPool } from "../browser/worker.js";
import { readSession } from "../flow/session-broker.js";

export type KeepaliveDeps = {
  accounts: AccountRepository;
  browsers: BrowserWorkerPool;
  intervalMs: number;
  log?: (message: string) => void;
  /** Số lần thử lại khi dính lỗi browser tạm (navigation/context destroyed). Mặc định 2. */
  maxAttempts?: number;
  /** Delay giữa các lần retry (ms). Mặc định 1500. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 1_500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lỗi Playwright/trang đang navigate — không đồng nghĩa cookie Google hết hạn. */
export function isTransientKeepaliveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return (
    lower.includes("execution context was destroyed") ||
    lower.includes("most likely because of a navigation") ||
    lower.includes("target page, context or browser has been closed") ||
    lower.includes("target closed") ||
    lower.includes("frame was detached") ||
    lower.includes("navigating frame was detached") ||
    lower.includes("page crashed") ||
    lower.includes("net::err_") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("navigation")
  );
}

function isHardReauthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("FLOW_REAUTH_REQUIRED");
}

// Giữ session sống bằng cách định kỳ gọi Flow session endpoint,
// tránh Google expire cookie vì browser ngồi im quá lâu.
// Chỉ touch account healthy + không có lease (idle), skip nếu vừa
// verified/used trong nửa interval gần nhất.
//
// Chỉ đánh reauth_required khi session THẬT sự unauthenticated /
// FLOW_REAUTH_REQUIRED. Lỗi navigation/context destroyed (rất hay gặp
// khi SPA Flow redirect giữa lúc page.evaluate) chỉ retry rồi bỏ qua —
// không đốt account ra khỏi pool.
export function createKeepalive(deps: KeepaliveDeps) {
  const { accounts, browsers, intervalMs } = deps;
  const log = deps.log ?? (() => undefined);
  const maxAttempts = Math.max(1, deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const retryDelayMs = Math.max(0, deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const sleep = deps.sleep ?? defaultSleep;
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstTick: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function keepOneAccount(alias: string, id: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (stopped) return;
      try {
        // Lần retry: invalidate browser slot để tạo context/page mới,
        // tránh evaluate trên page đang mid-navigation.
        if (attempt > 1) {
          await browsers.invalidate(id).catch(() => undefined);
          if (retryDelayMs > 0) await sleep(retryDelayMs);
        }

        const browser = await browsers.forAccount(id);
        const session = await readSession(browser.page, { verifyScope: false });
        if (session.summary.authenticated) {
          await browser.persist().catch(() => undefined);
          accounts.markVerified(id);
          log(
            attempt > 1
              ? `keepalive: ${alias} session ok (after ${attempt} attempts)`
              : `keepalive: ${alias} session ok`,
          );
          return;
        }

        log(`keepalive: ${alias} session not authenticated → reauth_required`);
        accounts.setStatus(id, "reauth_required", { failureCode: "session_unauthenticated" });
        await browsers.invalidate(id);
        return;
      } catch (err) {
        lastError = err;
        if (isHardReauthError(err)) {
          log(`keepalive: ${alias} FLOW_REAUTH_REQUIRED → reauth_required`);
          accounts.setStatus(id, "reauth_required", { failureCode: "FLOW_REAUTH_REQUIRED" });
          await browsers.invalidate(id).catch(() => undefined);
          return;
        }

        if (isTransientKeepaliveError(err) && attempt < maxAttempts) {
          log(
            `keepalive: ${alias} transient error (attempt ${attempt}/${maxAttempts}): ${
              err instanceof Error ? err.message : "unknown"
            }`,
          );
          continue;
        }

        // Hết retry hoặc lỗi không phân loại được: GIỮ healthy, chỉ log +
        // invalidate browser để lần sau (job/keepalive) mở context mới.
        // Đánh reauth vĩnh viễn vì 1 cú navigation race là sai (đã làm 03/04/05
        // ra khỏi pool đến khi operator enroll tay).
        log(
          `keepalive: ${alias} skipped (kept healthy) after ${attempt} attempt(s): ${
            err instanceof Error ? err.message : "unknown"
          }`,
        );
        await browsers.invalidate(id).catch(() => undefined);
        return;
      }
    }

    // Không tới đây trong logic hiện tại; phòng hờ.
    if (lastError) {
      log(
        `keepalive: ${alias} skipped (kept healthy): ${
          lastError instanceof Error ? lastError.message : "unknown"
        }`,
      );
      await browsers.invalidate(id).catch(() => undefined);
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const candidates = accounts.listHealthyIdle();
    if (candidates.length === 0) return;

    const halfIntervalAgo = Date.now() - intervalMs / 2;
    const active: Array<{ alias: string; id: string }> = [];
    for (const a of candidates) {
      const last = Math.max(
        a.lastVerifiedAt ? new Date(a.lastVerifiedAt).getTime() : 0,
        a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0,
      );
      if (last >= halfIntervalAgo) continue;
      active.push({ alias: a.alias, id: a.id });
    }

    // Xử lý tuần tự, mỗi account một context riêng.
    // KHÔNG song song để tránh tranh chấp slot + đỡ nặng CPU Chromium.
    for (const { alias, id } of active) {
      await keepOneAccount(alias, id);
    }
  }

  return {
    start(): void {
      stopped = false;
      // Chạy tick đầu sau 10s để không va vào init pool.
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (timer.unref) timer.unref();
      firstTick = setTimeout(() => {
        void tick();
      }, 10_000);
      if (firstTick.unref) firstTick.unref();
    },

    async stop(): Promise<void> {
      stopped = true;
      if (firstTick) {
        clearTimeout(firstTick);
        firstTick = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    // Expose for unit tests.
    tick,
    keepOneAccount,
  };
}
