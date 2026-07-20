/**
 * Rate limit + retry cho mọi model tạo/sửa ảnh (token-bucket per model).
 *
 * - gemini-3-pro-image, gemini-2.5-flash-image (Vertex qua CPA): mặc định 5 RPM
 *   (pool ~2 RPM/project × vài project; chừa buffer). Env: VERTEX_IMAGE_RPM.
 * - Mọi model ảnh khác (gồm gemini-3.1-flash-image Antigravity, Grok, GPT Image,
 *   Flow, bridge...): mặc định 8 RPM. Env: DEFAULT_IMAGE_RPM
 *   (alias: ANTIGRAVITY_IMAGE_RPM nếu DEFAULT_IMAGE_RPM chưa set).
 *
 * Lớp 1: token-bucket 60s — hết slot thì xếp hàng (timeout).
 * Lớp 2: gặp 429/exhausted/cooling → backoff rồi retry.
 */

const VERTEX_MODELS = new Set<string>([
  "gemini-3-pro-image",
  "gemini-2.5-flash-image",
]);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Vertex: giữ nguyên như trước (mặc định 5).
const VERTEX_IMAGE_RPM = envInt("VERTEX_IMAGE_RPM", 5);
// Các model còn lại: 8 RPM (Anh chốt 2026-07-21).
const DEFAULT_IMAGE_RPM = envInt(
  "DEFAULT_IMAGE_RPM",
  envInt("ANTIGRAVITY_IMAGE_RPM", 8),
);
const VERTEX_IMAGE_QUEUE_TIMEOUT_MS = envInt("VERTEX_IMAGE_QUEUE_TIMEOUT_MS", 30_000);
const VERTEX_IMAGE_RETRY_DELAY_MS = envInt("VERTEX_IMAGE_RETRY_DELAY_MS", 25_000);
const VERTEX_IMAGE_RETRY_MAX = envInt("VERTEX_IMAGE_RETRY_MAX", 2);

const WINDOW_MS = 60_000;

function rpmForModel(model: string): number {
  if (VERTEX_MODELS.has(model)) return VERTEX_IMAGE_RPM;
  return DEFAULT_IMAGE_RPM;
}

type Bucket = {
  stamps: number[];
  waiters: Array<{ resolve: () => void; reject: (e: Error) => void; deadline: number }>;
};

const buckets = new Map<string, Bucket>();

function getBucket(model: string): Bucket {
  let b = buckets.get(model);
  if (!b) {
    b = { stamps: [], waiters: [] };
    buckets.set(model, b);
  }
  return b;
}

function nowMs(): number {
  return Date.now();
}

function pruneOld(b: Bucket, now: number): void {
  const cutoff = now - WINDOW_MS;
  while (b.stamps.length > 0 && b.stamps[0] <= cutoff) {
    b.stamps.shift();
  }
}

function tryAcquire(b: Bucket, now: number, rpm: number): boolean {
  pruneOld(b, now);
  if (b.stamps.length < rpm) {
    b.stamps.push(now);
    return true;
  }
  return false;
}

function pumpWaiters(b: Bucket, rpm: number): void {
  const now = nowMs();
  b.waiters = b.waiters.filter((w) => {
    if (now >= w.deadline) {
      w.reject(
        new Error(
          "Hệ thống đang xử lý nhiều yêu cầu ảnh, vui lòng thử lại sau ít phút.",
        ),
      );
      return false;
    }
    return true;
  });

  while (b.waiters.length > 0) {
    pruneOld(b, now);
    if (b.stamps.length >= rpm) break;
    const w = b.waiters.shift()!;
    b.stamps.push(nowMs());
    w.resolve();
  }
}

function waitForToken(model: string, b: Bucket, rpm: number): Promise<void> {
  const now = nowMs();
  if (tryAcquire(b, now, rpm)) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const deadline = now + VERTEX_IMAGE_QUEUE_TIMEOUT_MS;
    b.waiters.push({ resolve, reject, deadline });
  });
}

function isRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("exhausted") ||
    m.includes("cooling down") ||
    m.includes("model_cooldown") ||
    m.includes("auth_unavailable") ||
    m.includes("resource has been exhausted")
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("Đã hủy chờ retry tạo ảnh."));
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Bọc lời gọi provider: acquire token (hoặc xếp hàng) → gọi fn → nếu gặp 429
 * thì backoff rồi retry. Áp dụng mọi model ảnh; RPM theo rpmForModel().
 */
export async function withVertexImageThrottle<T>(
  model: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const rpm = rpmForModel(model || "unknown");
  const bucketKey = model || "unknown";
  const b = getBucket(bucketKey);
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await waitForToken(bucketKey, b, rpm);
    pumpWaiters(b, rpm);

    try {
      return await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      attempt += 1;
      if (!isRateLimitError(message) || attempt > VERTEX_IMAGE_RETRY_MAX) {
        throw e;
      }
      console.warn(
        `[image-throttle] model=${bucketKey} rpm=${rpm} 429 detected, retry ${attempt}/${VERTEX_IMAGE_RETRY_MAX} after ${VERTEX_IMAGE_RETRY_DELAY_MS}ms`,
      );
      await sleep(VERTEX_IMAGE_RETRY_DELAY_MS, signal);
    }
  }
}
