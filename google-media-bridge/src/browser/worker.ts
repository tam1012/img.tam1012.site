import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { AccountRepository } from "../accounts/repository.js";
import { encryptJSON, decryptJSON } from "../security/vault.js";

export type AccountBrowser = {
  page: Page;
  context: BrowserContext;
  persist(): Promise<void>;
  close(): Promise<void>;
};

export interface BrowserWorkerPool {
  forAccount(accountId: string, opts?: { proxy?: boolean }): Promise<AccountBrowser>;
  invalidate(accountId: string): Promise<void>;
  close(): Promise<void>;
}

type PoolOptions = {
  chromiumPath: string;
  vaultKey: Buffer;
  accounts: AccountRepository;
  proxyUrl?: string;
};

type Slot = {
  context: BrowserContext;
  page: Page;
};

type ProxySettings = {
  server: string;
  username?: string;
  password?: string;
};

function parseProxyUrl(raw?: string): ProxySettings | undefined {
  if (!raw) return undefined;
  // Định dạng: http://user:pass@host:port
  const m = raw.match(/^(https?):\/\/(?:([^:]*):([^@]*)@)?(.+)$/);
  if (!m) return undefined;
  const [, scheme, user, pass, hostPort] = m;
  const server = `${scheme}://${hostPort}`;
  if (user && pass) return { server, username: user, password: pass };
  return { server };
}

// Xvfb + non-headless = better reCAPTCHA Enterprise score.
// DISPLAY env is set by docker-entrypoint.sh.
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-http2",
  "--disable-quic",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=TranslateUI,BlinkGenPropertyTrees",
];

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function createBrowserWorkerPool(options: PoolOptions): BrowserWorkerPool {
  let browser: Browser | undefined;
  const slots = new Map<string, Slot>();
  const slotsDirect = new Map<string, Slot>();
  const proxy = parseProxyUrl(options.proxyUrl);

  async function ensureBrowser(): Promise<Browser> {
    if (!browser) {
      const display = process.env.DISPLAY || ":99";
      browser = await chromium.launch({
        executablePath: options.chromiumPath,
        headless: false,
        args: [
          ...CHROMIUM_ARGS,
          `--display=${display}`,
        ],
      });
    }
    return browser;
  }

  async function createContextForAccount(
    accountId: string,
    useProxy: boolean,
  ): Promise<AccountBrowser> {
    const account = options.accounts.get(accountId);
    if (!account) throw new Error(`unknown account ${accountId}`);
    const storageState = decryptJSON<{ cookies: unknown[]; origins: unknown[] }>(
      options.vaultKey,
      account.encryptedStorageState,
    );
    const ctxProxy = useProxy ? proxy : undefined;
    const b = await ensureBrowser();
    const context = await b.newContext({
      storageState: {
        cookies: storageState.cookies as never,
        origins: storageState.origins as never,
      },
      userAgent: DEFAULT_UA,
      locale: "vi-VN",
      viewport: { width: 1365, height: 900 },
      ...(ctxProxy ? { proxy: ctxProxy } : {}),
    });
    // Giảm tín hiệu automation — reCAPTCHA Flow hay flag headless thuần.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    const slotMap = useProxy ? slots : slotsDirect;
    const existing = slotMap.get(accountId);
    if (existing) {
      await existing.context.close().catch(() => undefined);
    }
    slotMap.set(accountId, { context, page });

    const handle: AccountBrowser = {
      page,
      context,
      async persist() {
        const state = await context.storageState({ indexedDB: true });
        options.accounts.updateStorageState(accountId, encryptJSON(options.vaultKey, state));
      },
      async close() {
        slotMap.delete(accountId);
        await context.close().catch(() => undefined);
      },
    };
    return handle;
  }

  return {
    async forAccount(
      accountId: string,
      opts?: { proxy?: boolean },
    ): Promise<AccountBrowser> {
      const useProxy = opts?.proxy !== false;
      const slotMap = useProxy ? slots : slotsDirect;
      const existing = slotMap.get(accountId);
      if (existing) {
        return {
          page: existing.page,
          context: existing.context,
          async persist() {
            const state = await existing.context.storageState({ indexedDB: true });
            options.accounts.updateStorageState(
              accountId,
              encryptJSON(options.vaultKey, state),
            );
          },
          async close() {
            slotMap.delete(accountId);
            await existing.context.close().catch(() => undefined);
          },
        };
      }
      return createContextForAccount(accountId, useProxy);
    },

    async invalidate(accountId: string): Promise<void> {
      for (const map of [slots, slotsDirect]) {
        const slot = map.get(accountId);
        if (!slot) continue;
        map.delete(accountId);
        await slot.context.close().catch(() => undefined);
      }
    },

    async close(): Promise<void> {
      for (const map of [slots, slotsDirect]) {
        for (const accountId of [...map.keys()]) {
          const slot = map.get(accountId)!;
          map.delete(accountId);
          await slot.context.close().catch(() => undefined);
        }
      }
      if (browser) {
        await browser.close().catch(() => undefined);
        browser = undefined;
      }
    },
  };
}
