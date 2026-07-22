/** Timeout cho fetch Google Flow trong Chromium (AbortController). */
export const UPSTREAM_FETCH_TIMEOUT_MS = 90_000;

/** Soft cooldown khi account dính nghẽn tạm — đủ để lần sau ưu tiên account khác. */
export const TRANSIENT_UPSTREAM_COOLDOWN_MS = 60_000;

/** Delay nền giữa các lần đổi account khi Google nghẽn (nhân theo attempt). */
export const ACCOUNT_RETRY_BASE_DELAY_MS = 1_500;

/** Số account tối đa thử cho edit (upload+generate hay dính high-traffic). */
export const EDIT_MAX_ACCOUNT_ATTEMPTS = 3;

/** Generate text-to-image ổn hơn — vẫn bounce 1 account phụ. */
export const GENERATE_MAX_ACCOUNT_ATTEMPTS = 2;

const UNSAFE_REASON_RE =
  /PUBLIC_ERROR_UNSAFE_GENERATION|UNSAFE_GENERATION|SAFETY|DANGER_FILTER|PUBLIC_ERROR_DANGER|BLOCKED|POLICY|IMAGE_SAFETY|PROMPT_BLOCKED/i;

export function extractUpstreamReason(raw: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        message?: string;
        status?: string;
        details?: Array<{ reason?: string; metadata?: Record<string, string> }>;
      };
      details?: Array<{ reason?: string; metadata?: Record<string, string> }>;
    };
    const details = parsed.error?.details ?? parsed.details ?? [];
    for (const d of details) {
      if (d?.reason && String(d.reason).trim()) return String(d.reason).trim().slice(0, 80);
      const metaReason = d?.metadata?.reason || d?.metadata?.errorCode;
      if (metaReason) return String(metaReason).trim().slice(0, 80);
    }
  } catch {
    /* fall through */
  }
  const m = raw.match(/PUBLIC_ERROR_[A-Z0-9_]+/i);
  return m ? m[0] : "";
}

export function extractUpstreamDetail(raw: string): string {
  if (!raw) return "";
  if (raw === "FETCH_TIMEOUT") return "FETCH_TIMEOUT";
  const reason = extractUpstreamReason(raw);
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; status?: string; code?: number | string };
      message?: string;
      status?: string;
    };
    const msg =
      parsed.error?.message ||
      parsed.message ||
      parsed.error?.status ||
      parsed.status ||
      "";
    const base = String(msg).replace(/\s+/g, " ").trim();
    if (reason && base) return `${reason} ${base}`.slice(0, 160);
    if (reason) return reason.slice(0, 160);
    return base.slice(0, 120);
  } catch {
    if (reason) return reason.slice(0, 160);
    return raw.replace(/\s+/g, " ").trim().slice(0, 80);
  }
}

export function isContentBlockedError(message: string): boolean {
  if (!message) return false;
  if (message.includes("FLOW_CONTENT_BLOCKED")) return true;
  if (UNSAFE_REASON_RE.test(message)) return true;
  return false;
}

/**
 * Map HTTP upstream → error code ổn định.
 * Content safety (UNSAFE_GENERATION) → FLOW_CONTENT_BLOCKED (không retry account).
 * Còn lại → FLOW_UPSTREAM_REJECTED + status/stage/detail.
 */
export function formatUpstreamRejected(status: number, raw = "", stage?: string): string {
  const detail = extractUpstreamDetail(raw);
  const reason = extractUpstreamReason(raw);
  const stagePart = stage ? ` stage=${stage}` : "";

  if (isContentBlockedError(reason) || isContentBlockedError(detail) || isContentBlockedError(raw)) {
    const label = reason || "UNSAFE_GENERATION";
    return `FLOW_CONTENT_BLOCKED reason=${label}${stagePart}`;
  }

  const statusLabel = status === 0 ? "timeout" : String(status);
  return detail
    ? `FLOW_UPSTREAM_REJECTED status=${statusLabel}${stagePart} ${detail}`
    : `FLOW_UPSTREAM_REJECTED status=${statusLabel}${stagePart}`;
}

/**
 * Lỗi tạm thời nên đổi account (không mark reauth).
 * 4xx client/auth/content cố định (400/401/403/404) → không bounce.
 */
export function isTransientUpstreamError(message: string): boolean {
  if (isContentBlockedError(message)) return false;
  if (!message.includes("FLOW_UPSTREAM_REJECTED")) return false;
  if (/\bstatus=(400|401|403|404)\b/.test(message)) return false;
  if (/\bstatus=(5\d\d|timeout|0)\b/.test(message)) return true;
  if (
    /HIGH_TRAFFIC|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE|FETCH_TIMEOUT|OVERLOADED|try again|ECONNRESET|network/i.test(
      message,
    )
  ) {
    return true;
  }
  // Opaque reject (thiếu status) — bounce an toàn hơn fail thẳng.
  if (!/\bstatus=/.test(message)) return true;
  return false;
}

/** Chromium/Playwright blip — đổi account hoặc retry, không reauth. */
export function isBrowserTransientError(message: string): boolean {
  return /page\.evaluate|Execution context was destroyed|Target closed|Target page, context or browser has been closed|Protocol error|browser has been closed|net::ERR_|Navigation failed/i.test(
    message,
  );
}

/**
 * Có nên thử account khác không.
 * Gồm: reauth, reCAPTCHA, quota, upstream nghẽn, browser blip.
 * KHÔNG: content blocked / 400 invalid argument cố định.
 */
export function isRetryableAccountError(message: string): boolean {
  if (isContentBlockedError(message)) return false;
  if (message.includes("FLOW_REAUTH_REQUIRED")) return true;
  if (message.includes("FLOW_QUOTA_EXCEEDED")) return true;
  if (
    message.includes("FLOW_RECAPTCHA_FAILED") ||
    message.includes("FLOW_RECAPTCHA_UNAVAILABLE")
  ) {
    return true;
  }
  if (isTransientUpstreamError(message)) return true;
  if (isBrowserTransientError(message)) return true;
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Payload lỗi trả client: code ổn định + message đọc được. */
export function publicFlowError(message: string): { message: string; code: string } {
  if (isContentBlockedError(message)) {
    return {
      code: "FLOW_CONTENT_BLOCKED",
      message:
        "FLOW_CONTENT_BLOCKED: Google Flow chặn ảnh/prompt này (bộ lọc an toàn). Hãy đổi prompt hoặc dùng ảnh khác — đổi account cũng không qua.",
    };
  }

  const code = message.startsWith("FLOW_")
    ? message.split(/\s+/)[0]!
    : "FLOW_UPSTREAM_REJECTED";

  if (
    (code === "FLOW_UPSTREAM_REJECTED" && isTransientUpstreamError(message)) ||
    isBrowserTransientError(message)
  ) {
    return {
      code: "FLOW_UPSTREAM_REJECTED",
      message:
        "FLOW_UPSTREAM_REJECTED: Google Flow tạm nghẽn, hãy thử lại sau khoảng 30 giây",
    };
  }

  // 400 invalid khác (không phải safety) — giữ chi tiết ngắn nếu có.
  if (code === "FLOW_UPSTREAM_REJECTED" && /\bstatus=400\b/.test(message)) {
    return {
      code,
      message:
        "FLOW_UPSTREAM_REJECTED: Google Flow từ chối request (invalid argument). Thử prompt/ảnh khác.",
    };
  }

  return { code, message: code };
}
