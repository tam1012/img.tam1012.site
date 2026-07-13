import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { VideoStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { logRequestStart, logRequestFailed, markRequestLogVideoDeleted } from "./request-log";
import { XAI_BASE_URL, isXaiQuotaError, runWithXaiAccount, xaiAuthPool } from "./xai-auth-pool";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const METADATA_FILE = path.join(VIDEOS_DIR, "metadata.json");

export const VEO_MODELS = [
  "veo-3.1-generate-001",
  "veo-3.1-fast-generate-001",
  "veo-3.0-generate-001",
  "veo-3.0-fast-generate-001",
  "veo-2.0-generate-001",
] as const;

export const XAI_VIDEO_MODELS = [
  "grok-imagine-video",
  "grok-imagine-video-1.5-preview",
] as const;

export const VIDEO_MODELS = [...VEO_MODELS, ...XAI_VIDEO_MODELS] as const;
export const PUBLIC_VIDEO_MODELS = [
  "veo-3.1-generate-001",
  "grok-imagine-video",
  "grok-imagine-video-1.5-preview",
] as const;

export type VideoModel = (typeof VIDEO_MODELS)[number];
export const DEFAULT_VIDEO_MODEL: VideoModel = "veo-3.1-generate-001";
export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export function isPublicVideoModel(model: string): boolean {
  return (PUBLIC_VIDEO_MODELS as readonly string[]).includes(model);
}

export function isXaiModel(model: string): boolean {
  return (XAI_VIDEO_MODELS as readonly string[]).includes(model);
}

export function isXaiImageToVideoOnly(model: string): boolean {
  return model === "grok-imagine-video-1.5-preview";
}

export function isXaiTextToVideoOnly(model: string): boolean {
  return model === "grok-imagine-video";
}

export function isXaiAvailable(): boolean {
  try {
    return xaiAuthPool.listAccounts().length > 0;
  } catch {
    return false;
  }
}

/** Độ phân giải hợp lệ theo từng model Veo (theo Vertex Studio). xAI không giới hạn rõ. */
export const VIDEO_RESOLUTIONS_BY_MODEL: Partial<Record<string, string[]>> = {
  "veo-3.1-generate-001": ["720p", "1080p", "4k"],
  "veo-3.1-fast-generate-001": ["720p", "1080p", "4k"],
  "veo-3.0-generate-001": ["720p", "1080p"],
  "veo-3.0-fast-generate-001": ["720p", "1080p"],
  "veo-2.0-generate-001": ["720p"],
};

function supportsAudio(model: string): boolean {
  return model.startsWith("veo-3");
}

function isValidResolution(model: string, resolution: string): boolean {
  if (isXaiModel(model)) return true;
  const allowed = VIDEO_RESOLUTIONS_BY_MODEL[model];
  return Array.isArray(allowed) && allowed.includes(resolution);
}

export interface VideoMetadata {
  id: string;
  prompt: string;
  model: string;
  aspect_ratio: string;
  resolution: string;
  duration_seconds: number;
  mode: "text" | "image";
  account: string;
  created_at: string;
}

type VertexCredentialFile = {
  project_id?: string;
  location?: string;
  service_account?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Tài khoản Vertex dùng riêng cho Veo. Mỗi account là 1 file SA mount trong container. */
const VIDEO_ACCOUNTS = [
  { id: "1", path: "/run/secrets/vertex-video-1.json" },
  { id: "2", path: "/run/secrets/vertex-video-2.json" },
] as const;

export type VideoAccountId = (typeof VIDEO_ACCOUNTS)[number]["id"];
export const DEFAULT_VIDEO_ACCOUNT: VideoAccountId = "1";

function readCredentialFile(path: string): { fileConfig: VertexCredentialFile; credentials: Record<string, unknown> } | null {
  if (!fs.existsSync(path)) return null;
  const fileConfig = JSON.parse(fs.readFileSync(path, "utf-8")) as VertexCredentialFile;
  const credentials = fileConfig.service_account || fileConfig;
  return { fileConfig, credentials };
}

function resolveProjectId(fileConfig: VertexCredentialFile, credentials: Record<string, unknown>): string | undefined {
  return fileConfig.project_id
    || (typeof credentials.project_id === "string" ? credentials.project_id : undefined);
}

/** Danh sách account video khả dụng (chỉ những file SA thực sự tồn tại), kèm project_id làm nhãn. */
export function listVideoAccounts(): { id: string; project_id: string }[] {
  const result: { id: string; project_id: string }[] = [];
  for (const acc of VIDEO_ACCOUNTS) {
    const loaded = readCredentialFile(acc.path);
    if (!loaded) continue;
    const projectId = resolveProjectId(loaded.fileConfig, loaded.credentials);
    result.push({ id: acc.id, project_id: projectId || acc.id });
  }
  return result;
}

export function isValidVideoAccount(accountId: string): boolean {
  return VIDEO_ACCOUNTS.some((a) => a.id === accountId);
}

/** Client Vertex AI riêng cho Veo theo account: ép location = "us-central1" (Veo không chạy ở "global"). */
function getVertexVideoClient(accountId: string): GoogleGenAI {
  const account = VIDEO_ACCOUNTS.find((a) => a.id === accountId);
  if (!account) {
    throw new Error("Tài khoản Vertex không hợp lệ");
  }

  const loaded = readCredentialFile(account.path);
  if (!loaded) {
    throw new Error(`Không tìm thấy file credentials cho tài khoản video "${accountId}"`);
  }

  const project = resolveProjectId(loaded.fileConfig, loaded.credentials);
  if (!project) {
    throw new Error("Service account JSON thiếu project_id");
  }

  // Veo yêu cầu region cụ thể; ép "us-central1" bất kể location trong SA JSON ("global").
  const location = "us-central1";

  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: { credentials: loaded.credentials },
  });
}

function ensureDir() {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

function getSafeVideoPath(id: string): string | null {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return path.join(VIDEOS_DIR, `${id}.mp4`);
}

function readMetadata(): VideoMetadata[] {
  if (!fs.existsSync(METADATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(METADATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMetadata(list: VideoMetadata[]) {
  ensureDir();
  fs.writeFileSync(METADATA_FILE, JSON.stringify(list, null, 2));
}

export function listVideos(): (VideoMetadata & { url: string })[] {
  return readMetadata()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((m) => ({ ...m, url: `/api/video/${m.id}` }));
}

export function getVideoFilePath(id: string): string | null {
  const filePath = getSafeVideoPath(id);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return filePath;
}

export interface GenerateVideoInput {
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  duration: number;
  account: string;
  /** Ảnh khung đầu cho image-to-video (base64). Không có = text-to-video. */
  image?: { data: string; mimeType: string };
}

async function generateVeoVideo(input: GenerateVideoInput, filePath: string): Promise<void> {
  const ai = getVertexVideoClient(input.account);

  const config: Record<string, unknown> = {
    aspectRatio: input.aspectRatio,
    numberOfVideos: 1,
    durationSeconds: input.duration,
    resolution: input.resolution,
    personGeneration: "allow_all",
  };
  if (supportsAudio(input.model)) {
    config.generateAudio = true;
  }

  let operation = await ai.models.generateVideos({
    model: input.model,
    prompt: input.prompt,
    ...(input.image ? { image: { imageBytes: input.image.data, mimeType: input.image.mimeType } } : {}),
    config,
  });

  const startTime = Date.now();
  while (!operation.done) {
    if (Date.now() - startTime > 600_000) throw new Error("Tạo video quá thời gian chờ (10 phút)");
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) throw new Error(JSON.stringify(operation.error));

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("Veo không trả về video");

  if (video.videoBytes) {
    fs.writeFileSync(filePath, Buffer.from(video.videoBytes, "base64"));
  } else if (video.uri) {
    await ai.files.download({ file: video, downloadPath: filePath });
    if (!fs.existsSync(filePath)) throw new Error("Tải video từ GCS thất bại");
  } else {
    throw new Error("Veo trả về video không có dữ liệu (thiếu videoBytes và uri)");
  }
}

async function generateXaiVideo(input: GenerateVideoInput, filePath: string): Promise<string> {
  const baseUrl = XAI_BASE_URL;

  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt || undefined,
    duration: input.duration,
    aspect_ratio: input.aspectRatio,
  };

  if (input.image) {
    body.image = { url: `data:${input.image.mimeType};base64,${input.image.data}` };
  }

  const created = await runWithXaiAccount(xaiAuthPool, async (selected) => {
    console.log(`[xAI video] create model=${input.model} account=${selected.id} hasImage=${!!input.image}`);
    const createRes = await fetch(`${baseUrl}/videos/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${selected.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => null);
      const msg = err?.error?.message || err?.error || `HTTP ${createRes.status}`;
      throw Object.assign(new Error(`xAI: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`), { status: createRes.status });
    }
    const data = await createRes.json();
    if (!data.request_id) throw new Error("xAI không trả về request_id");
    return data.request_id as string;
  });
  let account = created.account;
  const request_id = created.value;
  console.log(`[xAI video] created account=${account.id} request_id=${request_id}`);

  const startTime = Date.now();
  while (true) {
    if (Date.now() - startTime > 600_000) {
      console.error(`[xAI] timeout after ${Math.round((Date.now() - startTime) / 1000)}s request_id=${request_id}`);
      throw new Error("Tạo video quá thời gian chờ (10 phút)");
    }
    await new Promise((r) => setTimeout(r, 5_000));

    let pollRes = await fetch(`${baseUrl}/videos/${request_id}`, {
      headers: { Authorization: `Bearer ${account.apiKey}` },
    });

    if (pollRes.status === 401) {
      account = xaiAuthPool.reload(account);
      pollRes = await fetch(`${baseUrl}/videos/${request_id}`, {
        headers: { Authorization: `Bearer ${account.apiKey}` },
      });
    }

    if (!pollRes.ok) {
      const err = await pollRes.json().catch(() => null);
      if (pollRes.status === 429 || isXaiQuotaError(err?.error?.message || err?.error)) {
        xaiAuthPool.markCooldown(account);
      }
      console.error(`[xAI video] poll failed account=${account.id} status=${pollRes.status}`);
      throw new Error(`xAI poll lỗi: ${err?.error?.message || pollRes.status}`);
    }

    const data = await pollRes.json();
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[xAI] poll status=${data.status} elapsed=${elapsed}s request_id=${request_id}`);

    if (data.status === "done") {
      const videoUrl = data.video?.url;
      if (!videoUrl) throw new Error("xAI trả về done nhưng thiếu video URL");
      const dlRes = await fetch(videoUrl);
      if (!dlRes.ok) throw new Error("Tải video từ xAI thất bại");
      fs.writeFileSync(filePath, Buffer.from(await dlRes.arrayBuffer()));
      console.log(`[xAI video] success account=${account.id} elapsed=${elapsed}s bytes=${fs.statSync(filePath).size}`);
      return account.id;
    }
    if (data.status === "failed" || data.status === "expired") {
      console.error(`[xAI] video ${data.status} elapsed=${elapsed}s body=${JSON.stringify(data)}`);
      throw new Error(`xAI video ${data.status}`);
    }
  }
}

export async function generateVideo(input: GenerateVideoInput & { videoId: string }): Promise<VideoMetadata & { url: string }> {
  const mode: "text" | "image" = input.image ? "image" : "text";

  ensureDir();
  const filePath = path.join(VIDEOS_DIR, `${input.videoId}.mp4`);

  let usedAccount = input.account;
  if (isXaiModel(input.model)) {
    usedAccount = await generateXaiVideo(input, filePath);
  } else {
    await generateVeoVideo(input, filePath);
  }

  const metadata: VideoMetadata = {
    id: input.videoId,
    prompt: input.prompt,
    model: input.model,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution || "",
    duration_seconds: input.duration,
    mode,
    account: usedAccount,
    created_at: new Date().toISOString(),
  };

  return { ...metadata, url: `/api/video/${input.videoId}` };
}

export { isValidResolution };

export async function createVideoRecord(data: {
  userId: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  durationSeconds: number;
  mode: "text" | "image";
  account: string;
  costVnd: number;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const video = await tx.video.create({
      data: {
        userId: data.userId,
        prompt: data.prompt,
        model: data.model,
        aspectRatio: data.aspectRatio,
        resolution: data.resolution,
        durationSeconds: data.durationSeconds,
        mode: data.mode,
        account: data.account,
        costVnd: data.costVnd,
        status: "processing",
      },
      select: { id: true },
    });
    await logRequestStart(tx, {
      userId: data.userId,
      kind: "video",
      model: data.model,
      account: data.account,
      costVnd: data.costVnd,
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      relatedVideoId: video.id,
    });
    return video;
  });
}

export async function completeVideoRecord(id: string, filename: string, account?: string) {
  return prisma.$transaction(async (tx) => {
    const video = await tx.video.update({
      where: { id },
      data: { status: "completed", filename, ...(account ? { account } : {}) },
    });
    await tx.requestLog.updateMany({
      where: { relatedVideoId: id },
      data: { status: "completed", errorMessage: null, ...(account ? { account } : {}) },
    });
    return video;
  });
}

export async function failVideoRecord(id: string, errorMessage: string) {
  return prisma.$transaction(async (tx) => {
    const video = await tx.video.update({
      where: { id },
      data: { status: "failed", errorMessage },
    });
    await logRequestFailed(tx, { relatedVideoId: id }, errorMessage);
    return video;
  });
}

export async function getVideoById(id: string) {
  return prisma.video.findUnique({ where: { id } });
}

/** Xóa hẳn video: file mp4 + thumbnail + record DB. Ledger dùng SetNull nên không kẹt khóa ngoại. */
export async function deleteVideo(id: string, deletedBy?: string): Promise<boolean> {
  const videoPath = getSafeVideoPath(id);
  if (videoPath && fs.existsSync(videoPath)) {
    try { fs.unlinkSync(videoPath); } catch { /* ignore */ }
  }
  const thumbPath = path.join(VIDEOS_DIR, "thumbs", `${id}.jpg`);
  if (fs.existsSync(thumbPath)) {
    try { fs.unlinkSync(thumbPath); } catch { /* ignore */ }
  }
  if (deletedBy) {
    await markRequestLogVideoDeleted(id, deletedBy).catch(() => undefined);
  }
  try {
    await prisma.video.delete({ where: { id } });
  } catch {
    return false;
  }
  return true;
}

export async function listVideosByUser(userId: string, isAdmin: boolean) {
  const where = isAdmin ? { status: VideoStatus.completed } : { userId, status: VideoStatus.completed };
  const videos = await prisma.video.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return videos.map((v) => ({
    id: v.id,
    prompt: v.prompt,
    model: v.model,
    aspect_ratio: v.aspectRatio,
    resolution: v.resolution,
    duration_seconds: v.durationSeconds,
    mode: v.mode,
    account: v.account,
    url: `/api/video/${v.id}`,
    thumbnail_url: `/api/video/${v.id}/thumb`,
    created_at: v.createdAt.toISOString(),
  }));
}
