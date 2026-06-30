import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

export interface ProviderConfig {
  id: string;
  name: string;
  api_type: "openai" | "gemini";
  base_url: string;
  api_key: string;
  model: string;
  is_default: boolean;
  created_at: string;
}

export interface ImageRecord {
  id: string;
  prompt: string;
  edit_prompt: string | null;
  provider_id: string;
  provider_name: string;
  model: string;
  size: string | null;
  quality: string | null;
  filename: string;
  mime_type: string;
  original_image_id: string | null;
  created_by: string;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

interface DbData {
  providers: ProviderConfig[];
  images: ImageRecord[];
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readDb(): DbData {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    return { providers: [], images: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
    if (!data.providers) data.providers = [];
    if (!data.images) data.images = [];
    return data;
  } catch {
    return { providers: [], images: [] };
  }
}

function writeDb(data: DbData) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Provider operations
export function listProviders(): ProviderConfig[] {
  return readDb().providers;
}

export function getProviderById(id: string): ProviderConfig | null {
  return readDb().providers.find((p) => p.id === id) || null;
}

export function getDefaultProvider(): ProviderConfig | null {
  const providers = readDb().providers;
  return providers.find((p) => p.is_default) || providers[0] || null;
}

export function addProvider(provider: ProviderConfig) {
  const db = readDb();
  if (provider.is_default) {
    db.providers.forEach((p) => (p.is_default = false));
  }
  db.providers.push(provider);
  writeDb(db);
}

export function updateProvider(id: string, updates: Partial<ProviderConfig>) {
  const db = readDb();
  const idx = db.providers.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  if (updates.is_default) {
    db.providers.forEach((p) => (p.is_default = false));
  }
  db.providers[idx] = { ...db.providers[idx], ...updates };
  writeDb(db);
  return true;
}

export function deleteProvider(id: string): boolean {
  const db = readDb();
  const before = db.providers.length;
  db.providers = db.providers.filter((p) => p.id !== id);
  if (db.providers.length === before) return false;
  writeDb(db);
  return true;
}

// Image operations
function isVisibleImage(img: ImageRecord): boolean {
  return !img.deleted_at;
}

export function insertImage(record: ImageRecord) {
  const db = readDb();
  db.images.unshift(record);
  writeDb(db);
}

export function getImageById(id: string, includeDeleted = false): ImageRecord | null {
  const image = readDb().images.find((img) => img.id === id) || null;
  if (!image || (!includeDeleted && !isVisibleImage(image))) return null;
  return image;
}

export function listImages(limit = 50, offset = 0, creator?: string): ImageRecord[] {
  let images = readDb().images.filter(isVisibleImage);
  if (creator) images = images.filter((img) => img.created_by === creator);
  return images.slice(offset, offset + limit);
}

export function countImages(creator?: string): number {
  const images = readDb().images.filter(isVisibleImage);
  if (creator) return images.filter((img) => img.created_by === creator).length;
  return images.length;
}

export function getUniquePrompts(limit = 30, creator?: string): { prompt: string; provider_name: string; model: string; created_at: string }[] {
  let images = readDb().images.filter(isVisibleImage);
  if (creator) images = images.filter((img) => img.created_by === creator);
  const seen = new Set<string>();
  const results: { prompt: string; provider_name: string; model: string; created_at: string }[] = [];
  for (const img of images) {
    if (!seen.has(img.prompt)) {
      seen.add(img.prompt);
      results.push({
        prompt: img.prompt,
        provider_name: img.provider_name,
        model: img.model,
        created_at: img.created_at,
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function softDeleteImage(id: string, deletedBy: string): boolean {
  const db = readDb();
  const image = db.images.find((img) => img.id === id);
  if (!image || image.deleted_at) return false;
  image.deleted_at = new Date().toISOString();
  image.deleted_by = deletedBy;
  writeDb(db);
  return true;
}

export function countImagesByCreator(creator: string): number {
  return readDb().images.filter((img) => isVisibleImage(img) && img.created_by === creator).length;
}

export function countImagesByCreatorToday(creator: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return readDb().images.filter(
    (img) => img.created_by === creator && img.created_at.startsWith(today)
  ).length;
}
