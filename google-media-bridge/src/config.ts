import { z } from "zod";

const schema = z.object({
  FLOW_BRIDGE_HOST: z.string().default("0.0.0.0"),
  FLOW_BRIDGE_PORT: z.coerce.number().int().min(1).max(65535).default(8460),
  FLOW_BRIDGE_API_KEY: z.string().min(32),
  FLOW_BRIDGE_ADMIN_KEY: z.string().min(32),
  FLOW_VAULT_KEY: z.string().refine((value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  }, "FLOW_VAULT_KEY must be 32 raw bytes encoded as base64"),
  FLOW_ENROLLMENT_PRIVATE_KEY_FILE: z.string().min(1),
  FLOW_CHROMIUM_PATH: z.string().default("/usr/bin/chromium"),
  FLOW_DATA_DIR: z.string().default("/data"),
  FLOW_MAX_ACCOUNT_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  FLOW_RECAPTCHA_SITE_KEY: z.string().min(1).optional(),
  FLOW_RECAPTCHA_ACTION: z.string().default("IMAGE_GENERATION"),
  // Proxy dân cư sticky VN cho Chromium (optional — khi không set thì egress VPS).
  // Định dạng: http://user:pass@host:port
  FLOW_PROXY_URL: z.string().min(1).optional(),
  // Khoảng cách keep-alive (ms), mặc định 30 phút.
  FLOW_KEEPALIVE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(30 * 60_000),
});

export type BridgeConfig = {
  host: string;
  port: number;
  apiKey: string;
  adminKey: string;
  vaultKey: Buffer;
  enrollmentPrivateKeyFile: string;
  chromiumPath: string;
  dataDir: string;
  maxAccountConcurrency: number;
  recaptchaSiteKey?: string;
  recaptchaAction: string;
  proxyUrl?: string;
  keepaliveIntervalMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): BridgeConfig {
  const parsed = schema.parse(env);
  if (parsed.FLOW_BRIDGE_API_KEY === parsed.FLOW_BRIDGE_ADMIN_KEY) {
    throw new Error("FLOW_BRIDGE_API_KEY and FLOW_BRIDGE_ADMIN_KEY must differ");
  }
  return {
    host: parsed.FLOW_BRIDGE_HOST,
    port: parsed.FLOW_BRIDGE_PORT,
    apiKey: parsed.FLOW_BRIDGE_API_KEY,
    adminKey: parsed.FLOW_BRIDGE_ADMIN_KEY,
    vaultKey: Buffer.from(parsed.FLOW_VAULT_KEY, "base64"),
    enrollmentPrivateKeyFile: parsed.FLOW_ENROLLMENT_PRIVATE_KEY_FILE,
    chromiumPath: parsed.FLOW_CHROMIUM_PATH,
    dataDir: parsed.FLOW_DATA_DIR,
    maxAccountConcurrency: parsed.FLOW_MAX_ACCOUNT_CONCURRENCY,
    recaptchaSiteKey: parsed.FLOW_RECAPTCHA_SITE_KEY,
    recaptchaAction: parsed.FLOW_RECAPTCHA_ACTION,
    proxyUrl: parsed.FLOW_PROXY_URL,
    keepaliveIntervalMs: parsed.FLOW_KEEPALIVE_INTERVAL_MS,
  };
}
