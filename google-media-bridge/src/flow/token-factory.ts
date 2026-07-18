export type RecaptchaPage = {
  evaluate<T>(fn: string | ((arg: unknown) => T | Promise<T>), arg?: unknown): Promise<T>;
};

export type RecaptchaContract = {
  siteKey: string;
  action: string;
  /** Max wait for grecaptcha script after Flow page load (default 20s). */
  readyTimeoutMs?: number;
};

const DEFAULT_READY_TIMEOUT_MS = 20_000;

// Executes reCAPTCHA Enterprise inside the Flow page origin using the site's
// own grecaptcha instance. It never solves or bypasses a visible challenge.
//
// Fail codes:
// - FLOW_RECAPTCHA_UNAVAILABLE: script/API not ready after wait (cold page / proxy)
// - FLOW_RECAPTCHA_FAILED: execute threw or returned empty after one retry

async function waitForGrecaptchaReady(
  page: RecaptchaPage,
  timeoutMs: number,
): Promise<void> {
  try {
    const ready = await page.evaluate<boolean>(async (timeout) => {
      const deadline = Date.now() + Number(timeout || 0);
      while (Date.now() < deadline) {
        const globalScope = globalThis as unknown as {
          grecaptcha?: {
            enterprise?: {
              execute?: (key: string, opts: { action: string }) => Promise<string>;
              ready?: (cb: () => void) => void;
            };
          };
        };
        const enterprise = globalScope.grecaptcha?.enterprise;
        if (enterprise && typeof enterprise.execute === "function") {
          if (typeof enterprise.ready === "function") {
            await new Promise<void>((resolve) => {
              let done = false;
              const finish = () => {
                if (!done) {
                  done = true;
                  resolve();
                }
              };
              try {
                enterprise.ready!(finish);
              } catch {
                finish();
              }
              // ready() should fire quickly; don't hang forever inside ready.
              setTimeout(finish, 3_000);
            });
          }
          return true;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    }, timeoutMs);
    if (!ready) throw new Error("FLOW_RECAPTCHA_UNAVAILABLE");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("FLOW_RECAPTCHA_UNAVAILABLE")) throw error;
    throw new Error("FLOW_RECAPTCHA_UNAVAILABLE");
  }
}

async function executeOnce(page: RecaptchaPage, contract: RecaptchaContract): Promise<string> {
  const token = await page.evaluate<string>(
    (arg) => {
      const { siteKey, action } = arg as RecaptchaContract;
      const globalScope = globalThis as unknown as {
        grecaptcha?: { enterprise?: { execute?: (key: string, opts: { action: string }) => Promise<string> } };
      };
      const execute = globalScope.grecaptcha?.enterprise?.execute;
      if (typeof execute !== "function") {
        throw new Error("grecaptcha.enterprise.execute unavailable");
      }
      return execute(siteKey, { action });
    },
    contract,
  );
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("empty reCAPTCHA token");
  }
  return token;
}

export async function createRecaptchaToken(
  page: RecaptchaPage,
  contract: RecaptchaContract,
): Promise<string> {
  const readyTimeoutMs = contract.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  await waitForGrecaptchaReady(page, readyTimeoutMs);

  try {
    return await executeOnce(page, contract);
  } catch {
    // One retry only after short settle (SPA may re-inject grecaptcha).
    await new Promise((r) => setTimeout(r, 500));
    try {
      await waitForGrecaptchaReady(page, Math.min(5_000, readyTimeoutMs));
      return await executeOnce(page, contract);
    } catch {
      throw new Error("FLOW_RECAPTCHA_FAILED");
    }
  }
}
