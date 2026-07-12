import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  getImageById,
  listImages as dbListImages,
  countImages as dbCountImages,
  getUniquePrompts as dbGetUniquePrompts,
  softDeleteImage as dbSoftDeleteImage,
  softDeleteImages as dbSoftDeleteImages,
  hardDeleteImages as dbHardDeleteImages,
  hardDeleteAllUserImages as dbHardDeleteAllUserImages,
  countUserImagesIncludingDeleted as dbCountUserImagesIncludingDeleted,
  ImageRecord,
} from "./db";

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

export async function saveImageFile(id: string, data: Buffer, _mimeType: string): Promise<{ filename: string; mimeType: string }> {
  ensureDir();
  const filename = `${id}.webp`;
  const encoded = await encodeOutputImage(data);

  fs.writeFileSync(path.join(IMAGES_DIR, filename), encoded);
  try {
    await saveThumbnailFile(filename, encoded);
  } catch {
    // Ảnh gốc vẫn dùng được; thumbnail sẽ được thử sinh lại khi request.
  }

  return { filename, mimeType: "image/webp" };
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

export async function listImages(limit = 50, offset = 0, userId?: string): Promise<ImageRecord[]> {
  return dbListImages(limit, offset, userId);
}

export async function countImages(userId?: string): Promise<number> {
  return dbCountImages(userId);
}

export async function getImage(id: string, includeDeleted = false): Promise<ImageRecord | null> {
  return getImageById(id, includeDeleted);
}

export async function softDeleteImage(id: string, deletedBy: string, ownerUserId: string, isAdmin: boolean): Promise<boolean> {
  return dbSoftDeleteImage(id, deletedBy, ownerUserId, isAdmin);
}

export async function softDeleteImages(ids: string[], deletedBy: string, ownerUserId: string, isAdmin: boolean): Promise<number> {
  return dbSoftDeleteImages(ids, deletedBy, ownerUserId, isAdmin);
}

function deleteImageDiskFiles(filename: string) {
  const filePath = getSafeImagePath(filename);
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* best effort */ }
  }
  const thumbPath = getSafeImagePath(getThumbnailFilename(filename));
  if (thumbPath && fs.existsSync(thumbPath)) {
    try { fs.unlinkSync(thumbPath); } catch { /* best effort */ }
  }
}

/** Xóa vĩnh viễn record + file ảnh/thumbnail trên disk. */
export async function hardDeleteImages(ids: string[], ownerUserId: string, isAdmin: boolean): Promise<number> {
  const { deleted, filenames } = await dbHardDeleteImages(ids, ownerUserId, isAdmin);
  for (const filename of filenames) deleteImageDiskFiles(filename);
  return deleted;
}

/** Xóa vĩnh viễn toàn bộ ảnh của user (privacy). */
export async function hardDeleteAllUserImages(userId: string): Promise<number> {
  const { deleted, filenames } = await dbHardDeleteAllUserImages(userId);
  for (const filename of filenames) deleteImageDiskFiles(filename);
  return deleted;
}

export async function countUserImagesIncludingDeleted(userId: string): Promise<number> {
  return dbCountUserImagesIncludingDeleted(userId);
}

export async function getUniquePrompts(limit = 30, userId?: string) {
  return dbGetUniquePrompts(limit, userId);
}
