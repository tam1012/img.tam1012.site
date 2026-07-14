import { describe, expect, it, vi } from "vitest";
import { createRecaptchaToken, type RecaptchaPage } from "./token-factory.js";

function fakePage(results: Array<string | Error>) {
  const calls: unknown[] = [];
  let index = 0;
  const evaluate = vi.fn(async (_fn: unknown, arg?: unknown): Promise<unknown> => {
    calls.push(arg);
    const next = results[Math.min(index, results.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return next;
  });
  const page: RecaptchaPage = { evaluate: evaluate as RecaptchaPage["evaluate"] };
  return { page, evaluate };
}

describe("createRecaptchaToken", () => {
  it("returns a token from grecaptcha.enterprise.execute", async () => {
    const { page, evaluate } = fakePage(["token-abc123"]);
    const result = await createRecaptchaToken(page, { siteKey: "site-key", action: "FLOW_GENERATE" });
    expect(result).toMatch(/^token-/);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on failure then succeeds", async () => {
    const { page, evaluate } = fakePage([new Error("execute failed"), "token-second"]);
    const result = await createRecaptchaToken(page, { siteKey: "site-key", action: "FLOW_GENERATE" });
    expect(result).toBe("token-second");
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("does not retry more than once", async () => {
    const { page, evaluate } = fakePage([new Error("fail-1"), new Error("fail-2"), "token-late"]);
    await expect(
      createRecaptchaToken(page, { siteKey: "site-key", action: "FLOW_GENERATE" }),
    ).rejects.toThrow("FLOW_RECAPTCHA_FAILED");
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty token", async () => {
    const { page } = fakePage([""]);
    await expect(
      createRecaptchaToken(page, { siteKey: "site-key", action: "FLOW_GENERATE" }),
    ).rejects.toThrow("FLOW_RECAPTCHA_FAILED");
  });
});
