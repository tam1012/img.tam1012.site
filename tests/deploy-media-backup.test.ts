import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

function retainedSnapshotNames(names: string[]): string[] {
  return [...names]
    .filter((name) => /^img-data-before-deploy-\d{8}-\d{6}$/.test(name))
    .sort()
    .reverse()
    .slice(0, 3);
}

describe("media backup retention", () => {
  it("giữ ba snapshot mới nhất theo timestamp trong tên, không phụ thuộc mtime", () => {
    const names = [
      "img-data-before-deploy-20260705-165733",
      "img-data-before-deploy-20260711-171228",
      "img-data-before-deploy-20260709-134813",
      "img-data-before-deploy-20260711-173521",
      "img-data-before-deploy-20260711-172315",
    ];
    expect(retainedSnapshotNames(names)).toEqual([
      "img-data-before-deploy-20260711-173521",
      "img-data-before-deploy-20260711-172315",
      "img-data-before-deploy-20260711-171228",
    ]);
  });

  it("workflow không dùng ls -1dt cho retention backup media", () => {
    const section = workflow.slice(
      workflow.indexOf("img-data-before-deploy-$STAMP"),
      workflow.indexOf("# DB dump"),
    );
    expect(section).not.toMatch(/ls\s+-1dt/);
    expect(section).toMatch(/sort\s+-r/);
  });

  it("xác nhận snapshot tồn tại và không rỗng", () => {
    const section = workflow.slice(
      workflow.indexOf("img-data-before-deploy-$STAMP"),
      workflow.indexOf("# DB dump"),
    );
    expect(section).toContain('test -d "$MEDIA_BACKUP"');
    expect(section).toMatch(/find\s+"\$MEDIA_BACKUP"\s+-mindepth\s+1\s+-print\s+-quit/);
    expect(section).toMatch(/grep\s+-q/);
    expect(section).not.toMatch(/du\s+-s/);
  });

  it("chỉ xóa snapshot có tên timestamp hợp lệ bên trong backups", () => {
    const section = workflow.slice(
      workflow.indexOf("img-data-before-deploy-$STAMP"),
      workflow.indexOf("# DB dump"),
    );
    expect(section).toContain("img-data-before-deploy-*");
    expect(section).toContain("grep -E '^img-data-before-deploy-[0-9]{8}-[0-9]{6}$'");
    expect(section).toContain('rm -rf -- "./backups/$snapshot"');
  });
});
