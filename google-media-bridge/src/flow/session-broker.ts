import type { Page } from "playwright-core";

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

export async function readSession(page: Page): Promise<SessionBrokerResult> {
  await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  const result = await page.evaluate(
    async ([endpoint, scope]) => {
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
      let hasAisandbox = false;
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
    [SESSION_ENDPOINT, AISANDBOX_SCOPE] as const,
  );

  if (!result.summary.authenticated || !result.accessToken) {
    throw new Error("FLOW_REAUTH_REQUIRED");
  }
  if (!result.summary.hasAisandbox) {
    throw new Error("FLOW_REAUTH_REQUIRED");
  }
  return result;
}
