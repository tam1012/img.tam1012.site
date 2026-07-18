import { describe, expect, it, vi } from "vitest";
import { createRecaptchaToken, type RecaptchaPage } from "./token-factory.js";

function fakePage(results: Array<string | Error | boolean>) {
  let index = 0;
  const evaluate = vi.fn(async (_fn: unknown, _arg?: unknown): Promise<unknown> => {
    const next = results[Math.min(index, results.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return next;
  });
  const page: RecaptchaPage = { evaluate: evaluate as RecaptchaPage["evaluate"] };
  return { page, evaluate };
}

describe("createRecaptchaToken", () => {
  it("waits for grecaptcha ready then returns a token", async () => {
    // 1) wait ready → true, 2) execute → token
    const { page, evaluate } = fakePage([true, "token-abc123"]);
    const result = await createRecaptchaToken(page, {
      siteKey: "site-key",
      action: "FLOW_GENERATE",
      readyTimeoutMs: 1_000,
    });
    expect(result).toMatch(/^token-/);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("throws UNAVAILABLE when grecaptcha never becomes ready", async () => {
    const { page } = fakePage([false]);
    await expect(
      createRecaptchaToken(page, {
        siteKey: "site-key",
        action: "FLOW_GENERATE",
        readyTimeoutMs: 100,
      }),
    ).rejects.toThrow("FLOW_RECAPTCHA_UNAVAILABLE");
  });

  it("retries execute once after ready, then succeeds", async () => {
    // ready, fail execute, re-ready, token
    const { page, evaluate } = fakePage([true, new Error("execute failed"), true, "token-second"]);
    const result = await createRecaptchaToken(page, {
      siteKey: "site-key",
      action: "FLOW_GENERATE",
      readyTimeoutMs: 1_000,
    });
    expect(result).toBe("token-second");
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("does not retry execute more than once", async () => {
    const { page, evaluate } = fakePage([
      true,
      new Error("fail-1"),
      true,
      new Error("fail-2"),
      "token-late",
    ]);
    await expect(
      createRecaptchaToken(page, {
        siteKey: "site-key",
        action: "FLOW_GENERATE",
        readyTimeoutMs: 1_000,
      }),
    ).rejects.toThrow("FLOW_RECAPTCHA_FAILED");
    // ready + fail + ready + fail = 4 (not 5)
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("rejects an empty token after retry", async () => {
    const { page } = fakePage([true, "", true, ""]);
    await expect(
      createRecaptchaToken(page, {
        siteKey: "site-key",
        action: "FLOW_GENERATE",
        readyTimeoutMs: 1_000,
      }),
    ).rejects.toThrow("FLOW_RECAPTCHA_FAILED");
  });
});
