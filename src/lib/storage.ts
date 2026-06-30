import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { insertImage, getImageById, listImages as dbListImages, countImages as dbCountImages, getUniquePrompts as dbGetUniquePrompts, softDeleteImage as dbSoftDeleteImage, ImageRecord } from "./db";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const IMAGES_DIR = path.join(DATA_DIR, "images");

function ensureDir() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

export function saveImage(
  data: Buffer,
  mimeType: string,
  meta: {
    prompt: string;
    editPrompt?: string;
    providerId: string;
    providerName: string;
    model: string;
    size?: string;
    quality?: string;
    originalImageId?: string;
    createdBy?: string;
  }
): ImageRecord {
  ensureDir();
  const id = uuidv4();
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg"
    : mimeType.includes("webp") ? "webp"
    : "png";
  const filename = `${id}.${ext}`;

  fs.writeFileSync(path.join(IMAGES_DIR, filename), data);

  const record: ImageRecord = {
    id,
    prompt: meta.prompt,
    edit_prompt: meta.editPrompt || null,
    provider_id: meta.providerId,
    provider_name: meta.providerName,
    model: meta.model,
    size: meta.size || null,
    quality: meta.quality || null,
    filename,
    mime_type: mimeType,
    original_image_id: meta.originalImageId || null,
    created_by: meta.createdBy || "admin",
    created_at: new Date().toISOString(),
  };

  insertImage(record);
  return record;
}

export function getImageFile(filename: string): Buffer | null {
  const filePath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export function listImages(limit = 50, offset = 0, creator?: string): ImageRecord[] {
  return dbListImages(limit, offset, creator);
}

export function countImages(creator?: string): number {
  return dbCountImages(creator);
}

export function getImage(id: string, includeDeleted = false): ImageRecord | null {
  return getImageById(id, includeDeleted);
}

export function softDeleteImage(id: string, deletedBy: string): boolean {
  return dbSoftDeleteImage(id, deletedBy);
}

export function getUniquePrompts(limit = 30, creator?: string) {
  return dbGetUniquePrompts(limit, creator);
}
