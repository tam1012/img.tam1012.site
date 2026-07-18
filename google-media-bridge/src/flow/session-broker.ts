import type { Page } from "playwright-core";
import { randomUUID } from "node:crypto";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const SESSION_ENDPOINT = "/fx/api/auth/session";
const AISANDBOX_SCOPE = "https://www.googleapis.com/auth/aisandbox";

export type SessionSummary = {
  authenticated: boolean;
  hasAisandbox: boolean;
  tokenFamily: "ya29" | "other" | "none";
  hasExpiry: boolean;
};

export type SessionBrokerResult = {
  summary: SessionSummary;
  // Access token only for adapter call scope — never log or return over HTTP.
  accessToken: string;
};

// Đọc email account Google để điền nhãn cho account cũ (tạo trước khi có email).
// Chạy trong trang; token không rời trình duyệt. Session Flow trước, userinfo sau.
export async function readAccountEmail(page: Page): Promise<string | null> {
  return page
    .evaluate(async ([endpoint]) => {
      try {
        const res = await fetch(endpoint, { credentials: "include" });
        if (!res.ok) return null;
        const session = (await res.json()) as {
          access_token?: string;
          user?: { email?: string };
          email?: string;
        };
        if (session?.user?.email) return session.user.email;
        if (session?.email) return session.email;
        const token = session?.access_token;
        if (token) {
          const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (info.ok) {
            const data = (await info.json()) as { email?: string };
            if (data?.email) return data.email;
          }
        }
      } catch {
        return null;
      }
      return null;
    }, [SESSION_ENDPOINT] as const)
    .catch(() => null);
}

// verifyScope=true (mặc định, dùng khi enroll/verify): kiểm tra scope aisandbox
// qua googleapis. verifyScope=false (dùng khi poll video mỗi 5s): chỉ cần token
// từ session endpoint của Flow, KHÔNG gọi googleapis — tránh một cú blip mạng tới
// googleapis biến thành FLOW_REAUTH_REQUIRED giả giết job đang render. Scope đã
// được xác thực lúc enroll; nếu scope thật sự bị thu hồi thì API Flow sẽ trả 401/403.
export async function readSession(
  page: Page,
  options: { verifyScope?: boolean } = {},
): Promise<SessionBrokerResult> {
  const verifyScope = options.verifyScope ?? true;
  // Timeout cứng — proxy/mạng chậm không được treo verify/generate vô hạn.
  await page
    .goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 25_000 })
    .catch(() => undefined);
  const result = await page.evaluate(
    async ([endpoint, scope, doVerify]) => {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) {
        return {
          summary: {
            authenticated: false,
            hasAisandbox: false,
            tokenFamily: "none" as const,
            hasExpiry: false,
          },
          accessToken: "",
        };
      }
      const session = (await res.json()) as { access_token?: string; expires?: unknown };
      const token = session.access_token ?? "";
      if (!token) {
        return {
          summary: {
            authenticated: false,
            hasAisandbox: false,
            tokenFamily: "none" as const,
            hasExpiry: false,
          },
          accessToken: "",
        };
      }
      let hasAisandbox = !doVerify; // khi không verify: tin scope đã kiểm lúc enroll
      if (doVerify) {
        try {
          const info = await fetch(
            `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`,
          );
          if (info.ok) {
            const data = (await info.json()) as { scope?: string };
            hasAisandbox =
              typeof data.scope === "string" && data.scope.split(/\s+/).includes(scope);
          }
        } catch {
          hasAisandbox = false;
        }
      }
      return {
        summary: {
          authenticated: true,
          hasAisandbox,
          tokenFamily: token.startsWith("ya29") ? ("ya29" as const) : ("other" as const),
          hasExpiry: Boolean(session.expires),
        },
        accessToken: token,
      };
    },
    [SESSION_ENDPOINT, AISANDBOX_SCOPE, verifyScope] as const,
  );

  if (!result.summary.authenticated || !result.accessToken) {
    throw new Error("FLOW_REAUTH_REQUIRED");
  }
  if (verifyScope && !result.summary.hasAisandbox) {
    throw new Error("FLOW_REAUTH_REQUIRED");
  }
  return result;
}

export async function discoverProjectMeta(
  page: Page,
  accessToken: string,
): Promise<{ projectId: string | null; siteKey: string | null }> {
  let projectId: string | null = null;
  let siteKey: string | null = null;

  const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;

  // Intercept responses to find projectId from any aisandbox API
  const responseHandler = async (response: import("playwright-core").Response) => {
    if (projectId) return;
    const url = response.url();
    if (!/aisandbox-pa\.googleapis\.com/i.test(url)) return;
    const urlMatch = url.match(/\/projects\/([a-f0-9-]{36})\//);
    if (urlMatch) { projectId = urlMatch[1]; return; }
    try {
      const text = await response.text();
      const findId = (obj: unknown): string | null => {
        if (!obj || typeof obj !== "object") return null;
        const rec = obj as Record<string, unknown>;
        if (typeof rec.projectId === "string" && UUID_RE.test(rec.projectId))
          return rec.projectId;
        for (const v of Object.values(rec)) {
          const found = findId(v);
          if (found) return found;
        }
        return null;
      };
      const parsed = JSON.parse(text);
      const found = findId(parsed);
      if (found) projectId = found;
    } catch {}
  };

  page.on("response", responseHandler);
  try {
    // Re-navigate to trigger fresh API calls
    await page.goto(FLOW_URL, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);

    // siteKey from recaptcha enterprise script tags
    siteKey = await page.evaluate(() => {
      for (const s of document.querySelectorAll<HTMLScriptElement>(
        "script[src*='recaptcha']",
      )) {
        try {
          const render = new URL(s.src).searchParams.get("render");
          if (render && render.length > 10) return render;
        } catch {}
      }
      return null;
    }).catch(() => null);

    // Extra wait if projectId not yet found
    if (!projectId) {
      await new Promise((r) => setTimeout(r, 5_000));
    }

    // Flow projectId is generated client-side; any UUID works
    if (!projectId) {
      projectId = randomUUID();
      console.log(`[discover] generated client-side projectId=${projectId}`);
    }
  } finally {
    page.off("response", responseHandler);
  }

  return { projectId, siteKey };
}
