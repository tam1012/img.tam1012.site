export type SessionInput = {
  access_token?: string;
  expires?: unknown;
};

export type SessionSummary = {
  authenticated: boolean;
  tokenFamily: "ya29" | "opaque" | null;
  hasExpiry: boolean;
};

export function summarizeSession(session: SessionInput): SessionSummary {
  const token = session.access_token;
  if (!token) {
    return { authenticated: false, tokenFamily: null, hasExpiry: false };
  }
  return {
    authenticated: true,
    tokenFamily: token.startsWith("ya29") ? "ya29" : "opaque",
    hasExpiry: session.expires !== undefined && session.expires !== null && session.expires !== "",
  };
}
