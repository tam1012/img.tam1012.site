const secretKey = /authorization|cookie|token|recaptcha|email|signed|fifeurl|refresh|password|secret/i;
const secretValue =
  /ya29\.|Bearer\s+|SID=|@[a-z0-9.-]+\.[a-z]{2,}|[?&](token|signature|key|X-Goog-Signature)=/i;

function scrubString(value: string): string {
  if (secretValue.test(value)) return "[redacted]";
  if (value.length > 80 && /^[A-Za-z0-9+/=._-]{80,}$/.test(value)) return "[redacted-blob]";
  return value;
}

export function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (secretKey.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redact(child);
    }
    return out;
  }
  return "[redacted]";
}

export function redactText(text: string): string {
  return text
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/SID=[^;\s]+/g, "SID=[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]");
}
