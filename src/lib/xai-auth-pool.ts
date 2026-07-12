import fs from "node:fs";
import path from "node:path";

export const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_AUTH_DIR = "/run/secrets/xai-auths";
const LEGACY_AUTH_FILE = "/run/secrets/xai-auth.json";
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export interface XaiAccount {
  id: string;
  path: string;
  apiKey: string;
}

function readToken(filePath: string): string | null {
  try {
    const auth = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof auth.access_token === "string" && auth.access_token ? auth.access_token : null;
  } catch {
    return null;
  }
}

export class XaiAuthPool {
  private nextIndex = 0;
  private cooldownUntil = new Map<string, number>();

  constructor(
    private readonly authDir = process.env.XAI_AUTH_DIR || DEFAULT_AUTH_DIR,
    private readonly legacyFile = LEGACY_AUTH_FILE,
  ) {}

  listAccounts(): XaiAccount[] {
    let files: string[] = [];
    if (fs.existsSync(this.authDir)) {
      files = fs.readdirSync(this.authDir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => path.join(this.authDir, name));
    }
    if (files.length === 0 && fs.existsSync(this.legacyFile)) files = [this.legacyFile];

    return files.flatMap((filePath, index) => {
      const apiKey = readToken(filePath);
      return apiKey ? [{ id: `xai-${String(index + 1).padStart(2, "0")}`, path: filePath, apiKey }] : [];
    });
  }

  acquire(): XaiAccount {
    const accounts = this.listAccounts();
    if (accounts.length === 0) throw new Error("Không có tài khoản OAuth xAI khả dụng");
    const now = Date.now();
    for (let offset = 0; offset < accounts.length; offset++) {
      const index = (this.nextIndex + offset) % accounts.length;
      const account = accounts[index];
      if ((this.cooldownUntil.get(account.path) || 0) <= now) {
        this.nextIndex = (index + 1) % accounts.length;
        return account;
      }
    }
    throw new Error("Các tài khoản OAuth xAI đang tạm hết quota, vui lòng thử lại sau");
  }

  reload(account: XaiAccount): XaiAccount {
    const apiKey = readToken(account.path);
    if (!apiKey) throw new Error(`Không thể đọc lại OAuth ${account.id}`);
    return { ...account, apiKey };
  }

  markCooldown(account: XaiAccount, durationMs = DEFAULT_COOLDOWN_MS): void {
    this.cooldownUntil.set(account.path, Date.now() + durationMs);
  }
}

export const xaiAuthPool = new XaiAuthPool();

export async function runWithXaiAccount<T>(
  pool: XaiAuthPool,
  operation: (account: XaiAccount) => Promise<T>,
): Promise<{ value: T; account: XaiAccount }> {
  const accountCount = pool.listAccounts().length;
  if (accountCount === 0) throw new Error("Không có tài khoản OAuth xAI khả dụng");

  let lastError: unknown;
  for (let attempt = 0; attempt < accountCount; attempt++) {
    let account = pool.acquire();
    try {
      return { value: await operation(account), account };
    } catch (error: unknown) {
      lastError = error;
      if (xaiErrorStatus(error) === 401) {
        account = pool.reload(account);
        try {
          return { value: await operation(account), account };
        } catch (reloadError: unknown) {
          lastError = reloadError;
          if (xaiErrorStatus(reloadError) !== 401 && !isXaiQuotaError(reloadError)) throw reloadError;
        }
      } else if (!isXaiQuotaError(error)) {
        throw error;
      }
      pool.markCooldown(account);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Các tài khoản OAuth xAI đều không khả dụng");
}

export function xaiErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
}

export function isXaiQuotaError(error: unknown): boolean {
  const status = xaiErrorStatus(error);
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /quota|rate.?limit|too many requests/i.test(message);
}
