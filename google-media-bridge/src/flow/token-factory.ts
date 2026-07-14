export type RecaptchaPage = {
  evaluate<T>(fn: string | ((arg: unknown) => T | Promise<T>), arg?: unknown): Promise<T>;
};

export type RecaptchaContract = {
  siteKey: string;
  action: string;
};

// Executes reCAPTCHA Enterprise inside the Flow page origin using the site's
// own grecaptcha instance. It never solves or bypasses a visible challenge; a
// hard failure surfaces as FLOW_RECAPTCHA_FAILED after at most one retry.
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
  try {
    return await executeOnce(page, contract);
  } catch {
    // One retry only. Do not loop; a second failure means degraded/challenge.
    try {
      return await executeOnce(page, contract);
    } catch {
      throw new Error("FLOW_RECAPTCHA_FAILED");
    }
  }
}
