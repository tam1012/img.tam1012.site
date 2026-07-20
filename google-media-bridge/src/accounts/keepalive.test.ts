import { describe, expect, it, vi } from "vitest";
import { createKeepalive, isTransientKeepaliveError } from "./keepalive.js";
import type { AccountRepository } from "./repository.js";
import type { BrowserWorkerPool } from "../browser/worker.js";

function mockAccounts(overrides: Partial<AccountRepository> = {}): AccountRepository {
  return {
    list: vi.fn(() => []),
    get: vi.fn(() => null),
    getByAlias: vi.fn(() => null),
    insert: vi.fn(),
    getByEmail: vi.fn(() => null),
    setEmail: vi.fn(),
    updateStorageState: vi.fn(),
    setStatus: vi.fn(),
    setProjectMeta: vi.fn(),
    markVerified: vi.fn(),
    nextAlias: vi.fn(() => "flow-01"),
    delete: vi.fn(),
    countByStatus: vi.fn(() => ({})),
    listHealthyIdle: vi.fn(() => [
      {
        id: "acc-3",
        alias: "flow-03",
        encryptedStorageState: "enc",
        status: "healthy",
        activeLeases: 0,
        cooldownUntil: null,
        lastVerifiedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        lastUsedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        failureCode: null,
        projectId: "p",
        siteKey: "s",
        email: "lovanmuon87@gmail.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]),
    ...overrides,
  } as unknown as AccountRepository;
}

describe("isTransientKeepaliveError", () => {
  it("nhận diện lỗi navigation/context destroyed", () => {
    expect(
      isTransientKeepaliveError(
        new Error(
          "page.evaluate: Execution context was destroyed, most likely because of a navigation",
        ),
      ),
    ).toBe(true);
    expect(isTransientKeepaliveError(new Error("Timeout 25000ms exceeded"))).toBe(true);
    expect(isTransientKeepaliveError(new Error("FLOW_REAUTH_REQUIRED"))).toBe(false);
  });
});

describe("keepalive", () => {
  it("retry lỗi navigation rồi session ok → markVerified, không reauth", async () => {
    const accounts = mockAccounts();
    const persist = vi.fn(async () => undefined);
    let calls = 0;
    const page = {
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error(
            "page.evaluate: Execution context was destroyed, most likely because of a navigation",
          );
        }
        return {
          summary: {
            authenticated: true,
            hasAisandbox: true,
            tokenFamily: "ya29",
            hasExpiry: true,
          },
          accessToken: "ya29.ok",
        };
      }),
    };
    const browsers = {
      forAccount: vi.fn(async () => ({
        page,
        context: {} as never,
        persist,
        close: vi.fn(async () => undefined),
      })),
      invalidate: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserWorkerPool;

    const logs: string[] = [];
    const keepalive = createKeepalive({
      accounts,
      browsers,
      intervalMs: 30 * 60_000,
      maxAttempts: 2,
      retryDelayMs: 0,
      sleep: async () => undefined,
      log: (m) => logs.push(m),
    });

    await keepalive.tick();

    expect(accounts.markVerified).toHaveBeenCalledWith("acc-3");
    expect(accounts.setStatus).not.toHaveBeenCalled();
    expect(browsers.invalidate).toHaveBeenCalled();
    expect(logs.some((l) => l.includes("session ok"))).toBe(true);
  });

  it("hết retry transient → giữ healthy, không set reauth_required", async () => {
    const accounts = mockAccounts();
    const page = {
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => {
        throw new Error(
          "page.evaluate: Execution context was destroyed, most likely because of a navigation",
        );
      }),
    };
    const browsers = {
      forAccount: vi.fn(async () => ({
        page,
        context: {} as never,
        persist: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      })),
      invalidate: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserWorkerPool;

    const logs: string[] = [];
    const keepalive = createKeepalive({
      accounts,
      browsers,
      intervalMs: 30 * 60_000,
      maxAttempts: 2,
      retryDelayMs: 0,
      sleep: async () => undefined,
      log: (m) => logs.push(m),
    });

    await keepalive.tick();

    expect(accounts.setStatus).not.toHaveBeenCalled();
    expect(accounts.markVerified).not.toHaveBeenCalled();
    expect(browsers.invalidate).toHaveBeenCalled();
    expect(logs.some((l) => l.includes("kept healthy"))).toBe(true);
  });

  it("FLOW_REAUTH_REQUIRED thật → reauth_required", async () => {
    const accounts = mockAccounts();
    const page = {
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({
        summary: {
          authenticated: false,
          hasAisandbox: false,
          tokenFamily: "none",
          hasExpiry: false,
        },
        accessToken: "",
      })),
    };
    const browsers = {
      forAccount: vi.fn(async () => ({
        page,
        context: {} as never,
        persist: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      })),
      invalidate: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserWorkerPool;

    const keepalive = createKeepalive({
      accounts,
      browsers,
      intervalMs: 30 * 60_000,
      maxAttempts: 2,
      retryDelayMs: 0,
      sleep: async () => undefined,
    });

    await keepalive.tick();

    expect(accounts.setStatus).toHaveBeenCalledWith("acc-3", "reauth_required", {
      failureCode: "FLOW_REAUTH_REQUIRED",
    });
    expect(browsers.invalidate).toHaveBeenCalledWith("acc-3");
  });
});
