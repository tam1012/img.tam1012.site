/** Timeout cho fetch Google Flow trong Chromium (AbortController). */
export const UPSTREAM_FETCH_TIMEOUT_MS = 90_000;

/** Soft cooldown khi account dính nghẽn tạm — đủ để lần sau ưu tiên account khác. */
export const TRANSIENT_UPSTREAM_COOLDOWN_MS = 60_000;

export function extractUpstreamDetail(raw: string): string {
  if (!raw) return "";
  if (raw === "FETCH_TIMEOUT") return "FETCH_TIMEOUT";
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
    return String(msg).replace(/\s+/g, " ").trim().slice(0, 120);
  } catch {
    return raw.replace(/\s+/g, " ").trim().slice(0, 80);
  }
}

/** status=0 nghĩa là timeout / abort phía browser. */
export function formatUpstreamRejected(status: number, raw = ""): string {
  const detail = extractUpstreamDetail(raw);
  const statusLabel = status === 0 ? "timeout" : String(status);
  return detail
    ? `FLOW_UPSTREAM_REJECTED status=${statusLabel} ${detail}`
    : `FLOW_UPSTREAM_REJECTED status=${statusLabel}`;
}

/**
 * Lỗi tạm thời nên đổi account 1 lần (không mark reauth).
 * 4xx client/auth cố định (400/401/403/404) → không bounce.
 */
export function isTransientUpstreamError(message: string): boolean {
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
  // Opaque reject (thiếu status) — 1 lần bounce an toàn hơn fail thẳng.
  if (!/\bstatus=/.test(message)) return true;
  return false;
}

/** Payload lỗi trả client: code ổn định + message gợi ý khi nghẽn. */
export function publicFlowError(message: string): { message: string; code: string } {
  const code = message.startsWith("FLOW_")
    ? message.split(/\s+/)[0]!
    : "FLOW_UPSTREAM_REJECTED";
  if (code === "FLOW_UPSTREAM_REJECTED" && isTransientUpstreamError(message)) {
    return {
      code,
      message:
        "FLOW_UPSTREAM_REJECTED: Google Flow tạm nghẽn, hãy thử lại sau khoảng 30 giây",
    };
  }
  return { code, message: code };
}
