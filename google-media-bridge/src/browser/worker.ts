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
  forAccount(accountId: string): Promise<AccountBrowser>;
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

export function createBrowserWorkerPool(options: PoolOptions): BrowserWorkerPool {
  let browser: Browser | undefined;
  const slots = new Map<string, Slot>();
  const proxy = parseProxyUrl(options.proxyUrl);

  async function ensureBrowser(): Promise<Browser> {
    if (!browser) {
      browser = await chromium.launch({
        executablePath: options.chromiumPath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
        ],
      });
    }
    return browser;
  }

  return {
    async forAccount(accountId: string): Promise<AccountBrowser> {
      const existing = slots.get(accountId);
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
            slots.delete(accountId);
            await existing.context.close().catch(() => undefined);
          },
        };
      }

      const account = options.accounts.get(accountId);
      if (!account) throw new Error(`unknown account ${accountId}`);
      const storageState = decryptJSON<{ cookies: unknown[]; origins: unknown[] }>(
        options.vaultKey,
        account.encryptedStorageState,
      );
      const b = await ensureBrowser();
      const context = await b.newContext({
        storageState: {
          cookies: storageState.cookies as never,
          origins: storageState.origins as never,
        },
        ...(proxy ? { proxy } : {}),
      });
      const page = await context.newPage();
      slots.set(accountId, { context, page });

      const handle: AccountBrowser = {
        page,
        context,
        async persist() {
          const state = await context.storageState({ indexedDB: true });
          options.accounts.updateStorageState(accountId, encryptJSON(options.vaultKey, state));
        },
        async close() {
          slots.delete(accountId);
          await context.close().catch(() => undefined);
        },
      };
      return handle;
    },

    async invalidate(accountId: string): Promise<void> {
      const slot = slots.get(accountId);
      if (!slot) return;
      slots.delete(accountId);
      await slot.context.close().catch(() => undefined);
    },

    async close(): Promise<void> {
      for (const accountId of [...slots.keys()]) {
        await this.invalidate(accountId);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
        browser = undefined;
      }
    },
  };
}
