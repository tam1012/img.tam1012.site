import type { AccountRepository } from "./repository.js";
import type { BrowserWorkerPool } from "../browser/worker.js";
import { readSession } from "../flow/session-broker.js";

export type KeepaliveDeps = {
  accounts: AccountRepository;
  browsers: BrowserWorkerPool;
  intervalMs: number;
  log?: (message: string) => void;
};

// Giữ session sống bằng cách định kỳ gọi Flow session endpoint,
// tránh Google expire cookie vì browser ngồi im quá lâu.
// Chỉ touch account healthy + không có lease (idle), skip nếu vừa
// verified/used trong nửa interval gần nhất.
// Nếu session fail → reauth_required để operator biết.
export function createKeepalive(deps: KeepaliveDeps) {
  const { accounts, browsers, intervalMs } = deps;
  const log = deps.log ?? (() => undefined);
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstTick: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function keepOneAccount(alias: string, id: string): Promise<void> {
    try {
      const browser = await browsers.forAccount(id);
      const session = await readSession(browser.page, { verifyScope: false });
      if (session.summary.authenticated) {
        await browser.persist().catch(() => undefined);
        accounts.markVerified(id);
        log(`keepalive: ${alias} session ok`);
      } else {
        log(`keepalive: ${alias} session not authenticated → reauth_required`);
        accounts.setStatus(id, "reauth_required");
        await browsers.invalidate(id);
      }
    } catch (err) {
      log(`keepalive: ${alias} error → reauth_required (${err instanceof Error ? err.message : "unknown"})`);
      accounts.setStatus(id, "reauth_required");
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
  };
}
