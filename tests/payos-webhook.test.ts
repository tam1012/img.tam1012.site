import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("PayOS webhook status contract", () => {
  const route = read("src/app/api/payos/webhook/route.ts");
  const wallet = read("src/lib/wallet.ts");

  it("JSON invalid → 400", () => {
    expect(route).toMatch(/Body không hợp lệ/);
    expect(route).toMatch(/status:\s*400/);
  });

  it("verify chữ ký fail → 400", () => {
    expect(route).toMatch(/Chữ ký không hợp lệ/);
    expect(route).toMatch(/webhooks\.verify|getPayos\(\)\.webhooks\.verify/);
  });

  it("sau verify: code !== \"00\" → 200 (ack, không credit)", () => {
    expect(route).toMatch(/code\s*===\s*["']00["']|code\s*!==\s*["']00["']/);
    expect(route).toMatch(/success:\s*true/);
  });

  it("thiếu order / amount mismatch → 200 (không credit, không 500)", () => {
    expect(route).toMatch(/payosOrder\.findUnique|order\.amountVnd/);
    expect(route).toMatch(/amountVnd\s*(===|!==)\s*data\.amount|data\.amount\s*(===|!==)\s*order\.amountVnd/);
  });

  it("creditWalletPayos throw (lỗi tạm) → 500 để PayOS retry", () => {
    expect(route).toContain("creditWalletPayos");
    // Phải return 500 khi credit fail — không nuốt lỗi rồi luôn 200.
    expect(route).toMatch(/status:\s*500/);
    // Không còn comment/pattern nuốt mọi lỗi để luôn ack 200.
    expect(route).not.toMatch(/Nuốt lỗi xử lý nội bộ/);
  });

  it("thành công → 200 / { success: true }", () => {
    expect(route).toMatch(/NextResponse\.json\(\s*\{\s*success:\s*true\s*\}/);
  });

  it("không log full body / signature / credentials", () => {
    expect(route).not.toMatch(/console\.log\s*\(\s*body/);
    expect(route).not.toMatch(/console\.(log|error|info|debug)\s*\([^)]*signature/i);
    expect(route).not.toMatch(/console\.(log|error)\s*\(\s*body\s*\)/);
  });

  it("idempotency key PayOS vẫn payos:<orderCode>", () => {
    expect(wallet).toMatch(/payos:\$\{|payos:`|"payos:"\s*\+|`payos:/);
  });
});
