import { describe, expect, it } from "vitest";
import { createBrowserWorkerPool } from "./worker.js";

describe("browser worker pool contract", () => {
  it("exposes forAccount/invalidate/close", () => {
    const pool = createBrowserWorkerPool({
      chromiumPath: "/usr/bin/chromium",
      vaultKey: Buffer.alloc(32, 1),
      accounts: {
        get: () => null,
        updateStorageState: () => undefined,
      } as never,
    });
    expect(typeof pool.forAccount).toBe("function");
    expect(typeof pool.invalidate).toBe("function");
    expect(typeof pool.close).toBe("function");
  });
});
