import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { BridgeConfig } from "./config.js";
import { encryptEnrollment } from "./security/enrollment.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string, privateKeyPath: string): BridgeConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    apiKey: "m".repeat(32),
    adminKey: "a".repeat(32),
    vaultKey: Buffer.alloc(32, 3),
    enrollmentPrivateKeyFile: privateKeyPath,
    chromiumPath: "/usr/bin/chromium",
    dataDir: dir,
    maxAccountConcurrency: 1,
    recaptchaSiteKey: "site-key",
    recaptchaAction: "IMAGE_GENERATION",
  };
}

describe("bridge app routes", () => {
  it("separates media and admin auth; enrollment returns alias only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-app-"));
    temps.push(dir);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const privateKeyPath = join(dir, "private.pem");
    writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });

    const bridge = await buildApp(testConfig(dir, privateKeyPath));
    await bridge.app.ready();

    const health = await bridge.app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });

    const mediaDenied = await bridge.app.inject({
      method: "GET",
      url: "/admin/v1/accounts",
      headers: { authorization: `Bearer ${"m".repeat(32)}` },
    });
    expect(mediaDenied.statusCode).toBe(401);

    const bundle = encryptEnrollment(
      {
        version: 1,
        issuedAt: new Date().toISOString(),
        storageState: { cookies: [], origins: [] },
      },
      publicKey,
    );

    const enrolled = await bridge.app.inject({
      method: "POST",
      url: "/admin/v1/enrollments",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      payload: {
        bundle,
        projectId: "00000000-0000-0000-0000-000000000001",
        siteKey: "site-key",
      },
    });
    expect(enrolled.statusCode).toBe(201);
    const body = enrolled.json() as { id: string; alias: string; status: string };
    expect(body.alias).toBe("flow-01");
    expect(body.status).toBe("healthy");
    expect(JSON.stringify(body)).not.toContain("ya29");
    expect(JSON.stringify(body)).not.toContain("cookies");

    const listed = await bridge.app.inject({
      method: "GET",
      url: "/admin/v1/accounts",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      accounts: [{ alias: "flow-01", hasProject: true }],
    });

    await bridge.close();
  });
});
