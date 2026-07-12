import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("admin user lifecycle — no hard-delete", () => {
  const route = read("src/app/api/admin/users/[id]/route.ts");
  const page = read("src/app/admin/page.tsx");

  it("API không còn prisma.user.delete", () => {
    expect(route).not.toMatch(/prisma\.user\.delete\s*\(/);
  });

  it("DELETE handler (nếu còn) trả 405, không cascade", () => {
    // Vẫn có export DELETE để client cũ nhận 405 rõ ràng
    expect(route).toMatch(/export\s+async\s+function\s+DELETE/);
    expect(route).toMatch(/status:\s*405/);
    // Không hard-delete / cascade
    expect(route).not.toMatch(/prisma\.user\.delete\s*\(/);
    expect(route).not.toMatch(/deleteMany\s*\(/);
  });

  it("UI không còn nút/flow xoá user hard-delete", () => {
    expect(page).not.toMatch(/handleDelete/);
    expect(page).not.toMatch(/method:\s*["']DELETE["']/);
    expect(page).not.toMatch(/confirmAction\s*===\s*["']delete["']/);
    expect(page).not.toMatch(/setConfirmAction\s*\(\s*["']delete["']\s*\)/);
    expect(page).not.toMatch(/Xoá user|Xóa user/);
    expect(page).not.toMatch(/Xoá vĩnh viễn user|Xóa vĩnh viễn user/);
  });

  it("UI vẫn block/unblock qua PATCH + status active/blocked", () => {
    expect(page).toMatch(/method:\s*["']PATCH["']/);
    expect(page).toMatch(/status:\s*nextStatus|status.*blocked|status.*active/);
    expect(page).toMatch(/handleToggleBlock|Mở khoá|Khoá tài khoản/);
    expect(route).toMatch(/export\s+async\s+function\s+PATCH/);
    expect(route).toMatch(/status\s*!==\s*["']active["']|status\s*!==\s*["']blocked["']/);
  });
});
