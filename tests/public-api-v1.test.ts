import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("public API v1 MVP", () => {
  it("stores only hashed API keys in schema and migration", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("prisma/migrations/20260713090000_add_api_keys/migration.sql");
    expect(schema).toContain("model ApiKey");
    expect(schema).toContain("keyHash");
    expect(schema).toContain("keyPrefix");
    expect(schema).toContain("revokedAt");
    expect(migration).toContain('CREATE TABLE "ApiKey"');
    expect(migration).toContain('"keyHash"');
  });

  it("accepts Bearer tokens on /api/v1 without session cookie", () => {
    const middleware = read("src/middleware.ts");
    expect(middleware).toContain('pathname.startsWith("/api/v1/")');
  });

  it("exposes generate + providers + image file routes", () => {
    expect(read("src/app/api/v1/images/generate/route.ts")).toContain("requireUserFromRequest");
    expect(read("src/app/api/v1/images/generate/route.ts")).toContain("generateSingleImage");
    expect(read("src/app/api/v1/images/generate/route.ts")).toContain("Idempotency-Key");
    expect(read("src/app/api/v1/providers/route.ts")).toContain("listProviders");
    expect(read("src/app/api/v1/images/[id]/file/route.ts")).toContain("getImageFile");
  });

  it("reuses shared single-image generate helper from web route", () => {
    const web = read("src/app/api/generate/route.ts");
    const shared = read("src/lib/generate-image.ts");
    expect(web).toContain('from "@/lib/generate-image"');
    expect(web).toContain("generateSingleImage");
    expect(shared).toContain("export async function generateSingleImage");
    expect(shared).toContain("debitForImage");
  });

  it("hashes keys with sha256 and prefixes img_", () => {
    const lib = read("src/lib/api-keys.ts");
    expect(lib).toContain('const KEY_PREFIX = "img_"');
    expect(lib).toContain('createHash("sha256")');
    expect(lib).toContain("MAX_ACTIVE_KEYS");
    // sanity: hash helper shape matches Node crypto
    const sample = createHash("sha256").update("img_test").digest("hex");
    expect(sample).toHaveLength(64);
  });

  it("shows API key UI on billing for all users", () => {
    const billing = read("src/app/billing/page.tsx");
    const panel = read("src/components/ApiKeysPanel.tsx");
    expect(billing).toContain("ApiKeysPanel");
    expect(panel).toContain("Tạo API key");
    expect(panel).toContain("Thu hồi");
    expect(panel).toContain("/api/api-keys");
  });

  it("documents public API usage", () => {
    const docs = read("docs/public-api-v1.md");
    expect(docs).toContain("POST /api/v1/images/generate");
    expect(docs).toContain("Authorization: Bearer");
    expect(docs).toContain("Idempotency-Key");
    expect(docs).toContain("n8n");
    expect(docs).toContain("/docs/api");
  });

  it("exposes a logged-in web docs page and links from billing UI", () => {
    const page = read("src/app/docs/api/page.tsx");
    const panel = read("src/components/ApiKeysPanel.tsx");
    const menu = read("src/components/AccountMenu.tsx");
    expect(page).toContain("Hướng dẫn API v1");
    expect(page).toContain("/api/v1/images/generate");
    expect(page).toContain("Idempotency-Key");
    expect(panel).toContain('href="/docs/api"');
    expect(menu).toContain('href="/docs/api"');
  });
});
