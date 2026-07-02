import fs from "fs";
import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { insertImage, getImageById, listImages as dbListImages, countImages as dbCountImages, getUniquePrompts as dbGetUniquePrompts, softDeleteImage as dbSoftDeleteImage, ImageRecord } from "./db";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const IMAGES_DIR = path.join(DATA_DIR, "images");

function ensureDir() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function getSafeImagePath(filename: string): string | null {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  return path.join(IMAGES_DIR, filename);
}

function getThumbnailFilename(filename: string): string {
  return `${path.parse(filename).name}.thumb.webp`;
}

async function encodeOutputImage(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .rotate()
    .webp({ quality: 95, alphaQuality: 100, effort: 4 })
    .toBuffer();
}

async function encodeThumbnailImage(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .rotate()
    .resize(512, 512, { fit: "cover", position: "centre" })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
}

async function saveThumbnailFile(filename: string, data: Buffer): Promise<void> {
  const filePath = getSafeImagePath(getThumbnailFilename(filename));
  if (!filePath) return;
  const thumbnail = await encodeThumbnailImage(data);
  fs.writeFileSync(filePath, thumbnail);
}

export async function saveImage(
  data: Buffer,
  _mimeType: string,
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
): Promise<ImageRecord> {
  ensureDir();
  const id = uuidv4();
  const filename = `${id}.webp`;
  const encoded = await encodeOutputImage(data);

  fs.writeFileSync(path.join(IMAGES_DIR, filename), encoded);
  try {
    await saveThumbnailFile(filename, encoded);
  } catch {
    // Ảnh gốc vẫn dùng được; thumbnail sẽ được thử sinh lại khi request.
  }

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
    mime_type: "image/webp",
    original_image_id: meta.originalImageId || null,
    created_by: meta.createdBy || "admin",
    created_at: new Date().toISOString(),
  };

  insertImage(record);
  return record;
}

export function getImageFile(filename: string): Buffer | null {
  const filePath = getSafeImagePath(filename);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export async function getImageThumbnailFile(filename: string): Promise<{ data: Buffer; isFallback: boolean } | null> {
  const thumbnailPath = getSafeImagePath(getThumbnailFilename(filename));
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    try {
      return { data: fs.readFileSync(thumbnailPath), isFallback: false };
    } catch {
      // Nếu thumbnail lỗi quyền đọc/file hỏng, thử dùng ảnh gốc bên dưới.
    }
  }

  const original = getImageFile(filename);
  if (!original) return null;

  try {
    if (!thumbnailPath) return { data: original, isFallback: true };
    const thumbnail = await encodeThumbnailImage(original);
    fs.writeFileSync(thumbnailPath, thumbnail);
    return { data: thumbnail, isFallback: false };
  } catch {
    return { data: original, isFallback: true };
  }
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
