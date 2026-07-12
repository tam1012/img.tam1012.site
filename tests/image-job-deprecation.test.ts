import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("ImageJob schema deprecation (no drop)", () => {
  const schema = read("prisma/schema.prisma");
  const migrationPath = "prisma/migrations/20260711090000_add_image_jobs/migration.sql";

  it("vẫn có enum ImageJobStatus và model ImageJob", () => {
    expect(schema).toMatch(/enum\s+ImageJobStatus/);
    expect(schema).toMatch(/model\s+ImageJob\b/);
  });

  it("migration add_image_jobs vẫn tồn tại", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = read(migrationPath);
    expect(sql).toMatch(/ImageJob|image_job/i);
  });

  it("schema có comment deprecation gần ImageJob", () => {
    // Comment Prisma (/// hoặc //) chứa DEPRECATED/deprecated gần model/enum ImageJob
    expect(schema).toMatch(/DEPRECATED|deprecated/i);
    // deprecation phải nằm gần ImageJob (không chỉ ở chỗ khác)
    const jobBlock = schema.slice(
      Math.max(0, schema.search(/enum\s+ImageJobStatus|model\s+ImageJob/) - 400),
      schema.search(/model\s+ImageJob/) + 500,
    );
    expect(jobBlock).toMatch(/DEPRECATED|deprecated/i);
  });

  it("không có migration mới drop ImageJob trong change này", () => {
    const dirs = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    // Migration gốc add jobs vẫn còn; không có file drop
    expect(dirs).toContain("20260711090000_add_image_jobs");
    for (const dir of dirs) {
      const sqlPath = `prisma/migrations/${dir}/migration.sql`;
      if (!existsSync(sqlPath)) continue;
      const sql = read(sqlPath);
      // Cấm drop table/enum ImageJob
      expect(sql).not.toMatch(/DROP\s+TABLE\s+.*ImageJob/i);
      expect(sql).not.toMatch(/DROP\s+TYPE\s+.*ImageJobStatus/i);
    }
  });
});
