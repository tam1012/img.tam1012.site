import fs from "fs";
import { randomUUID } from "crypto";
import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ProviderConfig } from "../db";
import { XAI_BASE_URL, runWithXaiAccount, xaiAuthPool } from "../xai-auth-pool";
import { editFlowImageViaRoute, generateFlowImageViaRoute } from "../flow-client";
import { withVertexImageThrottle } from "../vertex-image-throttle";

export interface GenerateParams {
  prompt: string;
  width: number;
  height: number;
  quality: "standard" | "high";
  aspectRatio: string;
  resolution: string;
  count?: number;
}

export interface EditParams {
  images: { buffer: Buffer; mimeType: string }[];
  prompt: string;
  width: number;
  height: number;
  quality: "standard" | "high";
  aspectRatio: string;
  resolution: string;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  model: string;
}

function roundTo16(n: number): number {
  return Math.round(n / 16) * 16;
}

export function computePixelSize(aspectRatio: string, resolution: string): { width: number; height: number } {
  const longEdge: Record<string, number> = { "1K": 1024, "1.5K": 1536, "2K": 2048, "4K": 3840 };
  const ratios: Record<string, [number, number]> = {
    "1:1": [1, 1], "3:2": [3, 2], "4:3": [4, 3], "16:9": [16, 9], "2:3": [2, 3], "3:4": [3, 4], "9:16": [9, 16],
  };
  const base = longEdge[resolution] || 1024;
  const [aw, ah] = ratios[aspectRatio] || [1, 1];

  let width: number, height: number;
  if (aw >= ah) {
    width = base;
    height = roundTo16(base * ah / aw);
  } else {
    height = base;
    width = roundTo16(base * aw / ah);
  }

  // gpt-image-2: max 8,294,400 total pixels
  const maxPixels = 8_294_400;
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width = roundTo16(Math.floor(width * scale));
    height = roundTo16(Math.floor(height * scale));
  }

  return { width, height };
}

/** Tạo prefix hướng dẫn kích thước/chất lượng cho provider không hỗ trợ native params.
 *  Dùng cho Gemini native và chat completions (proxy). */
function buildImageInstructionPrefix(params: { width: number; height: number; quality: "standard" | "high"; aspectRatio: string; resolution: string }): string {
  const qualityDesc = params.quality === "high" ? "high detail, sharp, clean, high fidelity" : "standard quality, clean and natural";
  return `Output image requirements:
- Return exactly one final image.
- Canvas aspect ratio: ${params.aspectRatio}.
- Target resolution: exactly ${params.width} x ${params.height} pixels.
- Image size tier: ${params.resolution}.
- Fill the entire canvas; do not add borders, padding, frames, or letterboxing.
- Keep the requested aspect ratio; do not crop to a square image unless the requested ratio is 1:1.
- For edits, preserve the requested output canvas even if the input image has a different shape; naturally extend or crop the scene to fill the canvas.
- Quality: ${qualityDesc}.

`;
}

function isOpenAICompatModelFamily(model: string, family: "gemini" | "imagen"): boolean {
  const m = model.toLowerCase();
  return new RegExp(`(^|[\\/_.:-])${family}($|[\\/_.:-])`).test(m);
}

type GeminiChatGenerationConfig = {
  generationConfig?: {
    responseModalities: string[];
    imageConfig: {
      aspectRatio: string;
      imageSize: string;
    };
  };
  safetySettings?: { category: string; threshold: string }[];
};

// Tắt bộ lọc an toàn cho Gemini để tránh chặn nhầm (theo yêu cầu của chủ dự án).
const GEMINI_SAFETY_OFF = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
];

// Lưu ý: KHÔNG thêm thinkingConfig ở đây. Qua CLIProxyAPI, khi có thinkingConfig
// thì Gemini bỏ imageSize và trả về 1024x1024 (mất 2K/4K). Đã kiểm chứng bằng test.
function geminiChatGenerationConfig(model: string, params: { aspectRatio: string; resolution: string }): GeminiChatGenerationConfig {
  if (!isOpenAICompatModelFamily(model, "gemini")) return {};
  return {
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      imageConfig: {
        aspectRatio: params.aspectRatio,
        imageSize: params.resolution,
      },
    },
    safetySettings: GEMINI_SAFETY_OFF,
  };
}

/** Model Gemini hoặc Imagen qua OpenAI-compatible proxy dùng chat completions thay vì images endpoint. */
function shouldUseChatForOpenAI(model: string): boolean {
  return isOpenAICompatModelFamily(model, "gemini") || isOpenAICompatModelFamily(model, "imagen");
}

function isImagenModel(model: string): boolean {
  return isOpenAICompatModelFamily(model, "imagen");
}

function isGrokImagineImageModel(model: string): boolean {
  return /grok-imagine-image/i.test(model);
}

/** GPT Image (gpt-image-1/1.5/2...): proxy CLI hiện bỏ qua n>1 và chỉ trả 1 ảnh. */
function isGptImageModel(model: string): boolean {
  return /gpt-image/i.test(model);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Kiểm tra lỗi 400 có phải là content policy / moderation không. */
function isContentPolicyError(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  // Nhận diện qua error code (đáng tin cậy nhất)
  if (err.code === "content_policy_violation" || err.code === "moderation_blocked") {
    return true;
  }
  // Fallback: kiểm tra message nếu upstream không đặt code
  const msg = (err.message || "").toLowerCase();
  const markers = ["content_policy", "moderation", "safety_violation", "violat", "policy", "can't help", "explicit", "nudity", "sexual"];
  return markers.some((m) => msg.includes(m));
}

export async function generateImage(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage[]> {
  if (config.api_type === "chatgpt_bridge") {
    return bridgeGenerate(config, params);
  }
  if (config.api_type === "flow") {
    return flowGenerate(config, params);
  }
  if (config.api_type === "gemini") {
    return geminiGenerate(config, params);
  }
  if (config.api_type === "vertex") {
    return vertexGenerate(config, params);
  }
  return openaiGenerate(config, params);
}

export async function editImage(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  if (config.api_type === "chatgpt_bridge") {
    throw new Error("Provider ChatGPT Web Bridge chưa hỗ trợ chỉnh sửa ảnh.");
  }
  if (config.api_type === "flow") {
    return flowEdit(config, params);
  }
  if (config.api_type === "gemini") {
    return geminiEdit(config, params);
  }
  if (config.api_type === "vertex") {
    return vertexEdit(config, params);
  }
  return openaiEdit(config, params);
}

// ── Google Flow Media Bridge ─────────────────────────────────

async function flowGenerate(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage[]> {
  const count = Math.min(Math.max(params.count || 1, 1), 4);
  return withVertexImageThrottle(config.model, async () => {
    const images = await generateFlowImageViaRoute({
      prompt: params.prompt,
      model: config.model,
      aspectRatio: params.aspectRatio,
      width: params.width,
      height: params.height,
      n: count,
    });
    return images.map((img) => ({
      data: Buffer.from(img.b64_json, "base64"),
      mimeType: "image/png",
      model: config.model,
    }));
  });
}

async function flowEdit(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  if (!params.images?.length) {
    throw new Error("Cần ít nhất 1 ảnh để chỉnh sửa với Google Flow.");
  }
  return withVertexImageThrottle(config.model, async () => {
    const images = await editFlowImageViaRoute({
      prompt: params.prompt,
      model: config.model,
      aspectRatio: params.aspectRatio,
      width: params.width,
      height: params.height,
      n: 1,
      images: params.images.map((img) => ({
        buffer: img.buffer,
        mimeType: img.mimeType || "image/png",
      })),
    });
    const first = images[0];
    if (!first?.b64_json) throw new Error("FLOW_UPSTREAM_EMPTY");
    return {
      data: Buffer.from(first.b64_json, "base64"),
      mimeType: "image/png",
      model: config.model,
    };
  });
}

// ── ChatGPT Web Bridge ────────────────────────────────────

function resolveBridgeBaseUrl(config: ProviderConfig): string {
  const baseUrl = (config.base_url || "").trim().replace(/\/+$/, "");
  const dockerHostUrl = (process.env.CHATGPT_BRIDGE_BASE_URL || "").trim().replace(/\/+$/, "");
  if (dockerHostUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl)) {
    return dockerHostUrl;
  }
  return baseUrl;
}

async function bridgeGenerate(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage[]> {
  const count = params.count || 1;
  const results: GeneratedImage[] = [];
  let lastError: string | null = null;

  for (let i = 0; i < count; i++) {
    try {
      results.push(await bridgeGenerateOne(config, params, i));
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      if (results.length > 0) break; // partial success — return what we have
      throw new Error(`Tạo ảnh thất bại với ChatGPT Web Bridge: ${lastError}`);
    }
  }

  return results;
}

async function bridgeGenerateOne(config: ProviderConfig, params: GenerateParams, index: number): Promise<GeneratedImage> {
  return withVertexImageThrottle(config.model, async () => {
    const baseUrl = resolveBridgeBaseUrl(config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600_000);

    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: params.prompt,
          width: params.width,
          height: params.height,
          aspect_ratio: params.aspectRatio,
          resolution: params.resolution,
          quality: params.quality,
          request_id: `img-studio-${randomUUID()}-${index}`,
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        let message = `Bridge trả lỗi HTTP ${res.status}`;
        if (contentType.includes("application/json")) {
          const data = await res.json().catch(() => null);
          if (data?.error) message = `${data.code ? `${data.code}: ` : ""}${data.error}`;
        }
        throw new Error(message);
      }

      if (!contentType.startsWith("image/")) {
        throw new Error(`Bridge không trả về ảnh (content-type: ${contentType || "unknown"})`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1024) {
        throw new Error("Bridge trả về ảnh quá nhỏ hoặc rỗng");
      }

      return { data: buffer, mimeType: contentType.split(";")[0], model: config.model };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Bridge tạo ảnh quá thời gian chờ");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  });
}

// ── OpenAI Compatible ─────────────────────────────────────

async function openaiGenerate(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage[]> {
  const client = new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url || undefined,
  });
  const count = params.count || 1;

  if (shouldUseChatForOpenAI(config.model)) {
    try {
      const results: GeneratedImage[] = [];
      for (let i = 0; i < count; i++) {
        results.push(
          await withVertexImageThrottle(config.model, () =>
            chatCompletionsGenerate(client, config.model, params),
          ),
        );
      }
      return results;
    } catch (err: unknown) {
      throw new Error(`Tạo ảnh thất bại với model "${config.model}": ${errorMessage(err)}`);
    }
  }

  if (isGrokImagineImageModel(config.model)) {
    return grokDirectGenerate(config.model, params);
  }

  // gpt-image-* qua CLIProxy: n>1 được nhận nhưng chỉ trả 1 ảnh → loop n=1.
  if (isGptImageModel(config.model)) {
    return openaiGenerateByLoop(client, config.model, params, count);
  }

  try {
    const prefix = buildImageInstructionPrefix(params);
    return await withVertexImageThrottle(config.model, async () => {
      const response = await client.images.generate({
        model: config.model,
        prompt: `${prefix}${params.prompt}`,
        size: `${params.width}x${params.height}` as "1024x1024",
        quality: params.quality === "high" ? "high" : "medium",
        n: count,
      });
      return extractOpenAIImages(response, config.model);
    });
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError && err.status === 400) {
      if (!isContentPolicyError(err)) {
        try {
          const results: GeneratedImage[] = [];
          for (let i = 0; i < count; i++) {
            results.push(
              await withVertexImageThrottle(config.model, () =>
                chatCompletionsGenerate(client, config.model, params),
              ),
            );
          }
          return results;
        } catch {
          // Fallback thất bại -> ném lại lỗi gốc từ images.generate
        }
      }
    }
    throw err;
  }
}

async function openaiGenerateByLoop(
  client: OpenAI,
  model: string,
  params: GenerateParams,
  count: number,
): Promise<GeneratedImage[]> {
  const prefix = buildImageInstructionPrefix(params);
  const results: GeneratedImage[] = [];
  let lastError: unknown = null;

  for (let i = 0; i < count; i++) {
    try {
      const image = await withVertexImageThrottle(model, async () => {
        const response = await client.images.generate({
          model,
          prompt: `${prefix}${params.prompt}`,
          size: `${params.width}x${params.height}` as "1024x1024",
          quality: params.quality === "high" ? "high" : "medium",
          n: 1,
        });
        const images = await extractOpenAIImages(response, model);
        if (images.length === 0) throw new Error("Provider không trả về ảnh");
        return images[0];
      });
      results.push(image);
    } catch (err: unknown) {
      lastError = err;
      // Có ảnh rồi thì trả partial; batch route sẽ refund phần thiếu.
      if (results.length > 0) break;
      throw err;
    }
  }

  if (results.length === 0) {
    throw lastError instanceof Error ? lastError : new Error("Không tạo được ảnh nào");
  }
  return results;
}

async function openaiEdit(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  const client = new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url || undefined,
  });

  if (isImagenModel(config.model)) {
    throw new Error(`Chỉnh sửa ảnh thất bại với model "${config.model}": Model Imagen chỉ hỗ trợ tạo ảnh mới, không hỗ trợ chỉnh sửa ảnh.`);
  }

  if (shouldUseChatForOpenAI(config.model)) {
    try {
      return await withVertexImageThrottle(config.model, () =>
        chatCompletionsEdit(client, config.model, params),
      );
    } catch (err: unknown) {
      throw new Error(`Chỉnh sửa ảnh thất bại với model "${config.model}": ${errorMessage(err)}`);
    }
  }

  if (isGrokImagineImageModel(config.model)) {
    return grokDirectEdit(config.model, params);
  }

  try {
    const files = await Promise.all(
      params.images.map((img) => toFile(img.buffer, "image.png", { type: "image/png" }))
    );
    const prefix = buildImageInstructionPrefix(params);
    return await withVertexImageThrottle(config.model, async () => {
      const response = await client.images.edit({
        model: config.model,
        image: files.length === 1 ? files[0] : files,
        prompt: `${prefix}${params.prompt}`,
        size: `${params.width}x${params.height}` as "1024x1024",
        quality: params.quality === "high" ? "high" : "medium",
      });
      return extractOpenAIImage(response, config.model);
    });
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError && err.status === 400) {
      // Lỗi content policy → throw thẳng, không fallback, không gợi ý thừa
      if (isContentPolicyError(err)) {
        throw new Error(
          `Chỉnh sửa ảnh thất bại với model "${config.model}": ${err.message}`
        );
      }
      // Model không hỗ trợ images.edit (vd Gemini qua proxy, Imagen...)
      // → thử fallback chat completions (Gemini multimodal hoạt động qua đây)
      try {
        return await withVertexImageThrottle(config.model, () =>
          chatCompletionsEdit(client, config.model, params),
        );
      } catch (fallbackErr: unknown) {
        const fallbackMessage = errorMessage(fallbackErr);
        // Fallback cũng thất bại → hiển thị cả lỗi images.edit và lỗi chat thật để không che nguyên nhân.
        throw new Error(
          `Chỉnh sửa ảnh thất bại với model "${config.model}": images.edit: ${err.message}; chat.completions fallback: ${fallbackMessage}`
        );
      }
    }
    throw err;
  }
}

async function grokDirectGenerate(model: string, params: GenerateParams): Promise<GeneratedImage[]> {
  return withVertexImageThrottle(model, async () => {
    const grokRes = params.resolution === "4K" ? "2k" : params.resolution.toLowerCase();
    const prefix = buildImageInstructionPrefix(params);
    const { value, account } = await runWithXaiAccount(xaiAuthPool, async (selected) => {
      const client = new OpenAI({ apiKey: selected.apiKey, baseURL: XAI_BASE_URL });
      const response = await client.images.generate({
        model,
        prompt: `${prefix}${params.prompt}`,
        n: params.count || 1,
        // @ts-expect-error - xAI dùng aspect_ratio/resolution, OpenAI types không có
        aspect_ratio: params.aspectRatio,
        resolution: grokRes,
      });
      return extractOpenAIImages(response, model);
    });
    console.log(`[xAI image] generated model=${model} account=${account.id} count=${value.length}`);
    return value;
  });
}

async function grokDirectEdit(model: string, params: EditParams): Promise<GeneratedImage> {
  // xAI /v1/images/edits bắt buộc application/json (không phải multipart như OpenAI SDK images.edit).
  const source = params.images[0];
  if (!source) throw new Error("Thiếu ảnh nguồn để chỉnh sửa với Grok");

  return withVertexImageThrottle(model, async () => {
    const grokRes = params.resolution === "4K" ? "2k" : params.resolution.toLowerCase();
    const prefix = buildImageInstructionPrefix(params);
    const mimeType = source.mimeType || "image/png";
    const body = {
      model,
      prompt: `${prefix}${params.prompt}`,
      image: {
        url: `data:${mimeType};base64,${source.buffer.toString("base64")}`,
        type: "image_url" as const,
      },
      aspect_ratio: params.aspectRatio,
      resolution: grokRes,
    };

    const { value, account } = await runWithXaiAccount(xaiAuthPool, async (selected) => {
      const res = await fetch(`${XAI_BASE_URL}/images/edits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${selected.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const msg = err?.error?.message || err?.error || err?.message || `HTTP ${res.status}`;
        console.error(`[xAI image] edit failed account=${selected.id} status=${res.status}`);
        // Gắn status để runWithXaiAccount nhận 401/429/403 và xoay account khi cần.
        throw Object.assign(
          new Error(`xAI edit: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`),
          { status: res.status },
        );
      }

      const data = await res.json();
      return extractOpenAIImage(data as OpenAI.Images.ImagesResponse, model);
    });
    console.log(`[xAI image] edited model=${model} account=${account.id}`);
    return value;
  });
}

async function chatCompletionsGenerate(client: OpenAI, model: string, params: GenerateParams): Promise<GeneratedImage> {
  const prefix = buildImageInstructionPrefix(params);
  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & GeminiChatGenerationConfig = {
    model,
    messages: [{ role: "user", content: `${prefix}${params.prompt}` }],
    max_tokens: 4096,
    ...geminiChatGenerationConfig(model, params),
  };
  const response = await client.chat.completions.create(request);
  return extractChatImage(response, model);
}

async function chatCompletionsEdit(client: OpenAI, model: string, params: EditParams): Promise<GeneratedImage> {
  const prefix = buildImageInstructionPrefix(params);
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    ...params.images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: `data:${img.mimeType || "image/png"};base64,${img.buffer.toString("base64")}` },
    })),
    { type: "text" as const, text: `${prefix}${params.prompt}` },
  ];
  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & GeminiChatGenerationConfig = {
    model,
    messages: [{ role: "user", content }],
    max_tokens: 4096,
    ...geminiChatGenerationConfig(model, params),
  };
  const response = await client.chat.completions.create(request);
  return extractChatImage(response, model);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractChatImage(response: any, modelName: string): GeneratedImage {
  const choice = response.choices?.[0];
  const message = choice?.message;
  if (!message) throw new Error("Provider không trả về response");
  const images = message.images;
  if (Array.isArray(images) && images.length > 0) {
    const url: string = images[0]?.image_url?.url;
    if (url) return parseDataUrl(url, modelName);
  }
  const content = message.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "image_url" && part.image_url?.url) {
        return parseDataUrl(part.image_url.url, modelName);
      }
    }
  }
  const textContent = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join(" ")
      : "";
  if (textContent) {
    throw new Error(textContent.slice(0, 300));
  }
  if (message.refusal) {
    throw new Error(String(message.refusal).slice(0, 300));
  }
  const finishReason = choice?.finish_reason;
  if (finishReason === "content_filter") {
    throw new Error("Nội dung bị chặn bởi bộ lọc an toàn. Hãy thử điều chỉnh prompt, tránh yêu cầu liên quan đến nội dung nhạy cảm.");
  }
  console.error("[extractChatImage] No image in response:", JSON.stringify({ finish_reason: finishReason, content_type: typeof content, content_length: Array.isArray(content) ? content.length : null, refusal: message.refusal ?? null }).slice(0, 500));
  throw new Error(
    finishReason && finishReason !== "stop"
      ? `Model không trả về ảnh (finish_reason: ${finishReason}). Có thể prompt bị chặn bởi bộ lọc nội dung — hãy thử điều chỉnh lại.`
      : "Model không trả về ảnh. Có thể prompt bị chặn bởi bộ lọc nội dung — hãy thử điều chỉnh prompt, tránh yêu cầu nhạy cảm."
  );
}

function parseDataUrl(url: string, modelName: string): GeneratedImage {
  const match = url.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (match) {
    return { data: Buffer.from(match[2], "base64"), mimeType: match[1], model: modelName };
  }
  throw new Error("Provider trả về định dạng ảnh không hỗ trợ");
}

async function extractOpenAIImages(response: OpenAI.Images.ImagesResponse, modelName: string): Promise<GeneratedImage[]> {
  const items = response.data;
  if (!items || items.length === 0) throw new Error("Provider không trả về ảnh");
  const results: GeneratedImage[] = [];
  for (const item of items) {
    if (item.b64_json) {
      results.push({ data: Buffer.from(item.b64_json, "base64"), mimeType: "image/png", model: modelName });
    } else if (item.url) {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error("Không tải được ảnh từ URL provider trả về");
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type") || "image/png";
      results.push({ data: buf, mimeType: mime, model: modelName });
    }
  }
  if (results.length === 0) throw new Error("Provider không trả về ảnh");
  return results;
}

async function extractOpenAIImage(response: OpenAI.Images.ImagesResponse, modelName: string): Promise<GeneratedImage> {
  const images = await extractOpenAIImages(response, modelName);
  return images[0];
}

type VertexCredentialFile = {
  project_id?: string;
  location?: string;
  service_account?: Record<string, unknown>;
  [key: string]: unknown;
};

function getVertexClient() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let fileConfig: VertexCredentialFile | null = null;
  let credentials: Record<string, unknown> | undefined;

  if (credentialsPath && fs.existsSync(credentialsPath)) {
    fileConfig = JSON.parse(fs.readFileSync(credentialsPath, "utf-8")) as VertexCredentialFile;
    credentials = fileConfig.service_account || fileConfig;
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GOOGLE_PROJECT_ID
    || fileConfig?.project_id
    || (typeof credentials?.project_id === "string" ? credentials.project_id : undefined);
  const location = process.env.GOOGLE_CLOUD_LOCATION
    || process.env.GOOGLE_CLOUD_REGION
    || fileConfig?.location
    || "global";

  if (!project) {
    throw new Error("Vertex AI chưa được cấu hình GOOGLE_CLOUD_PROJECT hoặc project_id trong service account JSON.");
  }

  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    ...(credentials ? { googleAuthOptions: { credentials } } : {}),
  });
}

async function vertexGenerate(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage[]> {
  const ai = getVertexClient();
  const count = params.count || 1;
  const results: GeneratedImage[] = [];
  for (let i = 0; i < count; i++) {
    results.push(
      await withVertexImageThrottle(config.model, async () => {
        const response = await ai.models.generateContent({
          model: config.model,
          contents: params.prompt,
          config: {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: {
              aspectRatio: params.aspectRatio,
              imageSize: params.resolution,
            },
          },
        });
        return extractNewGeminiImage(response, config.model);
      }),
    );
  }
  return results;
}

async function vertexEdit(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  const ai = getVertexClient();
  const parts = [
    ...params.images.map((img) => ({
      inlineData: { mimeType: img.mimeType || "image/png", data: img.buffer.toString("base64") },
    })),
    { text: params.prompt },
  ];
  return withVertexImageThrottle(config.model, async () => {
    const response = await ai.models.generateContent({
      model: config.model,
      contents: parts,
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: {
          aspectRatio: params.aspectRatio,
          imageSize: params.resolution,
        },
      },
    });
    return extractNewGeminiImage(response, config.model);
  });
}

async function geminiGenerate(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage[]> {
  const ai = new GoogleGenAI({ apiKey: config.api_key });
  const count = params.count || 1;
  const results: GeneratedImage[] = [];
  for (let i = 0; i < count; i++) {
    results.push(
      await withVertexImageThrottle(config.model, async () => {
        const response = await ai.models.generateContent({
          model: config.model,
          contents: params.prompt,
          config: {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: {
              aspectRatio: params.aspectRatio,
              imageSize: params.resolution,
            },
          },
        });
        return extractNewGeminiImage(response, config.model);
      }),
    );
  }
  return results;
}

async function geminiEdit(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  const ai = new GoogleGenAI({ apiKey: config.api_key });
  const parts = [
    ...params.images.map((img) => ({
      inlineData: { mimeType: img.mimeType || "image/png", data: img.buffer.toString("base64") },
    })),
    { text: params.prompt },
  ];
  return withVertexImageThrottle(config.model, async () => {
    const response = await ai.models.generateContent({
      model: config.model,
      contents: parts,
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: {
          aspectRatio: params.aspectRatio,
          imageSize: params.resolution,
        },
      },
    });
    return extractNewGeminiImage(response, config.model);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNewGeminiImage(response: any, modelName: string): GeneratedImage {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          data: Buffer.from(part.inlineData.data, "base64"),
          mimeType: part.inlineData.mimeType || "image/png",
          model: modelName,
        };
      }
    }
    const textParts = parts.filter((p: { text?: string }) => p.text).map((p: { text: string }) => p.text).join(" ");
    if (textParts) throw new Error(textParts.slice(0, 300));
  }
  const finishReason = candidate?.finishReason;
  if (finishReason === "SAFETY") {
    throw new Error("Nội dung bị chặn bởi bộ lọc an toàn. Hãy thử điều chỉnh prompt, tránh yêu cầu liên quan đến nội dung nhạy cảm.");
  }
  throw new Error(
    finishReason && finishReason !== "STOP"
      ? `Model không trả về ảnh (${finishReason}). Có thể prompt bị chặn — hãy thử điều chỉnh lại.`
      : "Model không trả về ảnh. Có thể prompt bị chặn bởi bộ lọc nội dung — hãy thử điều chỉnh prompt."
  );
}
