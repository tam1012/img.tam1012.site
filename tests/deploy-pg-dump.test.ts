import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("deploy pg_dump before build", () => {
  const workflow = read(".github/workflows/deploy.yml");
  const docs = read("docs/deployment.md");

  it("có pg_dump custom-format (-Fc) vào ./backups/ trước docker compose build", () => {
    expect(workflow).toMatch(/pg_dump/);
    expect(workflow).toMatch(/-Fc\b/);
    expect(workflow).toMatch(/\.\/backups\/img-postgres-|backups\/img-postgres-/);
    expect(workflow).toMatch(/img-postgres-\$STAMP\.dump|img-postgres-.*\.dump/);

    const dumpIdx = workflow.indexOf("pg_dump");
    const buildIdx = workflow.indexOf("docker compose build");
    expect(dumpIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThan(dumpIdx);
  });

  it("dump fail abort deploy (set -e, không || true nuốt lỗi dump)", () => {
    expect(workflow).toMatch(/set -e/);
    // Không được nuốt lỗi pg_dump bằng || true trên dòng dump
    const dumpSection = workflow.slice(
      workflow.indexOf("pg_dump") - 120,
      workflow.indexOf("pg_dump") + 400,
    );
    expect(dumpSection).not.toMatch(/pg_dump[^;\n]*\|\|\s*true/);
  });

  it("retention 3 dump DB mới nhất, độc lập backup /data", () => {
    expect(workflow).toMatch(/img-postgres-\*\.dump/);
    expect(workflow).toMatch(/tail -n \+4/);
    // Vẫn giữ prune backup /data riêng
    expect(workflow).toMatch(/img-data-before-deploy-\*/);
  });

  it("thứ tự: backup /data → pg_dump → prune dump → build → up", () => {
    const dataBackupIdx = workflow.indexOf("img-data-before-deploy-$STAMP");
    const dumpIdx = workflow.indexOf("pg_dump");
    const pruneDumpIdx = workflow.indexOf("img-postgres-*.dump");
    const buildIdx = workflow.indexOf("docker compose build");
    const upIdx = workflow.indexOf("docker compose up");
    expect(dataBackupIdx).toBeGreaterThanOrEqual(0);
    expect(dumpIdx).toBeGreaterThan(dataBackupIdx);
    expect(pruneDumpIdx).toBeGreaterThan(dumpIdx);
    expect(buildIdx).toBeGreaterThan(pruneDumpIdx);
    expect(upIdx).toBeGreaterThan(buildIdx);
  });

  it("không hardcode password/secret trong workflow", () => {
    expect(workflow).not.toMatch(/POSTGRES_PASSWORD\s*=\s*['\"][^'\"]+['\"]/);
    expect(workflow).not.toMatch(/PGPASSWORD\s*=\s*['\"][^'\"]+['\"]/);
    // Không in password trong script
    expect(workflow).not.toMatch(/echo\s+.*PASSWORD/i);
  });

  it("docs/deployment.md mô tả pg_dump -Fc + retention 3 dump", () => {
    expect(docs).toMatch(/pg_dump/);
    expect(docs).toMatch(/-Fc|custom[- ]format/i);
    expect(docs).toMatch(/img-postgres-.*\.dump/);
    expect(docs).toMatch(/3\s*(bản|dump|backup)|giữ 3|retention/i);
  });
});
