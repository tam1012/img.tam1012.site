import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = join(root, "src", "store", "schema.sql");
const dest = join(root, "dist", "store", "schema.sql");
if (!existsSync(src)) {
  console.error("schema.sql missing:", src);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("copied schema.sql -> dist/store/");
