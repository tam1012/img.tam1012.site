import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

export interface ImageRecord {
  id: string;
  prompt: string;
  edit_prompt: string | null;
  provider: string;
  model: string;
  size: string | null;
  quality: string | null;
  filename: string;
  mime_type: string;
  original_image_id: string | null;
  created_at: string;
}

interface DbData {
  images: ImageRecord[];
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readDb(): DbData {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    return { images: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { images: [] };
  }
}

function writeDb(data: DbData) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function insertImage(record: ImageRecord) {
  const db = readDb();
  db.images.unshift(record);
  writeDb(db);
}

export function getImageById(id: string): ImageRecord | null {
  const db = readDb();
  return db.images.find((img) => img.id === id) || null;
}

export function listImages(limit = 50, offset = 0): ImageRecord[] {
  const db = readDb();
  return db.images.slice(offset, offset + limit);
}
