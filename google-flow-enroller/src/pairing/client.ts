import { createPKCE } from "./pkce.js";

export type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

export type TokenResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "slow_down"; interval: number }
  | { status: "ready"; enrollmentToken: string };

export type PairingFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

function assertHttpsOrLoopback(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    return;
  }
  throw new Error("PAIRING_BASE_URL_INSECURE");
}

export function createPairingClient(options: {
  baseUrl: string;
  fetchImpl?: PairingFetch;
  sleep?: (ms: number) => Promise<void>;
}) {
  assertHttpsOrLoopback(options.baseUrl);
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as PairingFetch);
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pkce = createPKCE();

  return {
    pkce,
    async startDevice(): Promise<DeviceStart> {
      const res = await fetchImpl(`${baseUrl}/api/flow/pairing/device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code_challenge: pkce.challenge, code_challenge_method: "S256" }),
      });
      if (res.status >= 400) throw new Error(`PAIRING_DEVICE_HTTP_${res.status}`);
      return (await res.json()) as DeviceStart;
    },

    async pollToken(deviceCode: string, intervalSec: number): Promise<TokenResult> {
      let interval = Math.max(1, intervalSec) * 1000;
      for (let i = 0; i < 120; i++) {
        await sleep(interval);
        const res = await fetchImpl(`${baseUrl}/api/flow/pairing/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_code: deviceCode,
            code_verifier: pkce.verifier,
          }),
        });
        if (res.status === 428) continue;
        if (res.status === 410) return { status: "expired" };
        if (res.status === 429) {
          interval = Math.min(interval * 2, 15_000);
          return { status: "slow_down", interval: interval / 1000 };
        }
        if (res.status >= 400) throw new Error(`PAIRING_TOKEN_HTTP_${res.status}`);
        const json = (await res.json()) as { enrollment_token?: string };
        if (!json.enrollment_token) throw new Error("PAIRING_TOKEN_MISSING");
        // Keep in memory only — caller must not log/persist.
        return { status: "ready", enrollmentToken: json.enrollment_token };
      }
      return { status: "expired" };
    },
  };
}
