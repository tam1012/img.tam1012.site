import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("completeImageRecord atomic transaction", () => {
  const source = read("src/lib/db.ts");

  // Cắt riêng thân hàm completeImageRecord để assert chính xác trong scope này.
  const fnMatch = source.match(
    /export async function completeImageRecord[\s\S]*?(?=\nexport async function |\nexport function |\n$)/,
  );
  const fn = fnMatch?.[0] ?? "";

  it("định nghĩa completeImageRecord", () => {
    expect(fn).toContain("export async function completeImageRecord");
  });

  it("bọc update image + imageUsage.upsert trong prisma.$transaction", () => {
    expect(fn).toMatch(/\$transaction\s*\(/);
    expect(fn).toMatch(/status:\s*["']completed["']/);
    expect(fn).toMatch(/imageUsage\.upsert/);
  });

  it("usage create nằm trong cùng transaction (không tạo usage sau khi update xong ngoài tx)", () => {
    // Pattern cũ: update xong rồi try/catch create usage bên ngoài.
    // Sau fix: create usage phải nằm trong callback/mảng $transaction.
    const txIdx = fn.search(/\$transaction\s*\(/);
    const usageIdx = fn.indexOf("imageUsage.upsert");
    expect(txIdx).toBeGreaterThanOrEqual(0);
    expect(usageIdx).toBeGreaterThan(txIdx);

    // Không còn console.error nuốt lỗi non-P2002 sau update (pattern cũ).
    expect(fn).not.toMatch(/console\.error\s*\(\s*["']\[imageUsage\]/);
  });

  it("idempotent theo imageId mà không gây unique violation trong transaction", () => {
    expect(fn).toMatch(/where:\s*\{\s*imageId:\s*image\.id\s*\}/);
    expect(fn).toMatch(/update:\s*\{\s*\}/);
    expect(fn).not.toContain("P2002");
    expect(fn).not.toMatch(/imageUsage\.create/);
  });

  it("giữ kind edit/generate và createdAt usage = image.createdAt", () => {
    expect(fn).toMatch(/editPrompt|originalImageId/);
    expect(fn).toMatch(/["']edit["']/);
    expect(fn).toMatch(/["']generate["']/);
    expect(fn).toMatch(/createdAt:\s*image\.createdAt/);
  });
});
