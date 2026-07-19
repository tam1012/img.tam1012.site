/**
 * Rate limit + retry cho model Gemini image đi qua Vertex AI (qua CPA).
 *
 * Lý do: Vertex AI quota `generate_content_image_gen_per_project_per_base_model`
 * = 2 request/phút cho mỗi cặp (project, model). Anh có 3 project Vertex →
 * pool ~6 ảnh/phút cho mỗi model. Vượt mức này Google trả 429 "Resource has
 * been exhausted" liên tục.
 *
 * Lớp 1 (token-bucket per model): giữ nhịp đầu vào ≤ N RPM để không vượt pool.
 *   - Còn token → gọi ngay.
 *   - Hết token → xếp hàng chờ tới lượt (có timeout).
 * Lớp 2 (retry backoff): nếu vẫn vấp 429/exhausted/cooling down → đợi rồi thử lại.
 *
 * Chỉ áp dụng cho model trong THROTTLED_MODELS (theo chỉ định của Anh).
 * Mọi model khác gọi thẳng, giữ behavior cũ.
 */

// 2 model Anh chỉ định đi qua Vertex AI (qua CPA).
const THROTTLED_MODELS = new Set<string>([
  "gemini-3-pro-image",
  "gemini-2.5-flash-image",
]);

function isThrottledModel(model: string): boolean {
  return THROTTLED_MODELS.has(model);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Pool Vertex ~6 ảnh/phút/model (3 project × 2 RPM). Chừa 1 buffer an toàn.
const VERTEX_IMAGE_RPM = envInt("VERTEX_IMAGE_RPM", 5);
const VERTEX_IMAGE_QUEUE_TIMEOUT_MS = envInt("VERTEX_IMAGE_QUEUE_TIMEOUT_MS", 30_000);
const VERTEX_IMAGE_RETRY_DELAY_MS = envInt("VERTEX_IMAGE_RETRY_DELAY_MS", 25_000);
const VERTEX_IMAGE_RETRY_MAX = envInt("VERTEX_IMAGE_RETRY_MAX", 2);

const WINDOW_MS = 60_000;

type Bucket = {
  // Mốc thời gian (ms) của các request đã được cấp token trong 60s qua.
  stamps: number[];
  // Hàng đợi các waiter đang chờ token.
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

function tryAcquire(b: Bucket, now: number): boolean {
  pruneOld(b, now);
  if (b.stamps.length < VERTEX_IMAGE_RPM) {
    b.stamps.push(now);
    return true;
  }
  return false;
}

function pumpWaiters(b: Bucket): void {
  const now = nowMs();
  // Tự hủy waiter quá deadline.
  b.waiters = b.waiters.filter((w) => {
    if (now >= w.deadline) {
      w.reject(
        new Error(
          "Hệ thống đang xử lý nhiều yêu cầu ảnh Vertex AI, vui lòng thử lại sau ít phút.",
        ),
      );
      return false;
    }
    return true;
  });

  while (b.waiters.length > 0) {
    pruneOld(b, now);
    if (b.stamps.length >= VERTEX_IMAGE_RPM) break;
    const w = b.waiters.shift()!;
    b.stamps.push(nowMs());
    w.resolve();
  }
}

function waitForToken(model: string, b: Bucket): Promise<void> {
  const now = nowMs();
  if (tryAcquire(b, now)) return Promise.resolve();

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
      reject(new Error("Đã hủy chờ retry Vertex AI."));
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
 * thì backoff rồi retry. Chỉ áp dụng cho model trong THROTTLED_MODELS.
 * Model khác: gọi thẳng fn, không limiter, không retry.
 */
export async function withVertexImageThrottle<T>(
  model: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!isThrottledModel(model)) {
    return fn();
  }

  const b = getBucket(model);
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await waitForToken(model, b);
    // Sau khi được cấp token, cố gắng bơm cho waiter kế tiếp (nếu còn slot).
    pumpWaiters(b);

    try {
      return await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      attempt += 1;
      if (!isRateLimitError(message) || attempt > VERTEX_IMAGE_RETRY_MAX) {
        throw e;
      }
      console.warn(
        `[vertex-throttle] model=${model} 429 detected, retry ${attempt}/${VERTEX_IMAGE_RETRY_MAX} after ${VERTEX_IMAGE_RETRY_DELAY_MS}ms`,
      );
      await sleep(VERTEX_IMAGE_RETRY_DELAY_MS, signal);
    }
  }
}
