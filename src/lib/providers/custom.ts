import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ProviderConfig } from "../db";

export interface GenerateParams {
  prompt: string;
  width: number;
  height: number;
  quality: "standard" | "high";
  aspectRatio: string;
  resolution: string;
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
    "1:1": [1, 1], "3:2": [3, 2], "16:9": [16, 9], "2:3": [2, 3], "9:16": [9, 16],
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
function buildImageInstructionPrefix(params: { width: number; height: number; quality: "standard" | "high" }): string {
  const qualityDesc = params.quality === "high" ? "highest possible" : "standard";
  return `[Image requirements: ${params.width}x${params.height} pixels, ${qualityDesc} quality]\n`;
}

function isOpenAICompatModelFamily(model: string, family: "gemini" | "imagen"): boolean {
  const m = model.toLowerCase();
  return new RegExp(`(^|[\\/_.:-])${family}($|[\\/_.:-])`).test(m);
}

/** Model Gemini hoặc Imagen qua OpenAI-compatible proxy dùng chat completions thay vì images endpoint. */
function shouldUseChatForOpenAI(model: string): boolean {
  return isOpenAICompatModelFamily(model, "gemini") || isOpenAICompatModelFamily(model, "imagen");
}

function isImagenModel(model: string): boolean {
  return isOpenAICompatModelFamily(model, "imagen");
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

export async function generateImage(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage> {
  if (config.api_type === "gemini") {
    return geminiGenerate(config, params);
  }
  return openaiGenerate(config, params);
}

export async function editImage(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  if (config.api_type === "gemini") {
    return geminiEdit(config, params);
  }
  return openaiEdit(config, params);
}

async function openaiGenerate(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage> {
  const client = new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url || undefined,
  });

  if (shouldUseChatForOpenAI(config.model)) {
    try {
      return await chatCompletionsGenerate(client, config.model, params);
    } catch (err: unknown) {
      throw new Error(`Tạo ảnh thất bại với model "${config.model}": ${errorMessage(err)}`);
    }
  }

  try {
    const response = await client.images.generate({
      model: config.model,
      prompt: params.prompt,
      size: `${params.width}x${params.height}` as "1024x1024",
      quality: params.quality === "high" ? "high" : "medium",
      n: 1,
    });
    return extractOpenAIImage(response, config.model);
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError && err.status === 400) {
      // Chỉ fallback sang chat completions nếu KHÔNG phải lỗi content policy
      if (!isContentPolicyError(err)) {
        try {
          return await chatCompletionsGenerate(client, config.model, params);
        } catch {
          // Fallback thất bại -> ném lại lỗi gốc từ images.generate,
          // không để lỗi 503 từ chat đè lên
        }
      }
    }
    throw err;
  }
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
      return await chatCompletionsEdit(client, config.model, params);
    } catch (err: unknown) {
      throw new Error(`Chỉnh sửa ảnh thất bại với model "${config.model}": ${errorMessage(err)}`);
    }
  }

  if (params.images.length > 1) {
    throw new Error("OpenAI chỉ hỗ trợ chỉnh sửa 1 ảnh. Vui lòng chọn provider Gemini để ghép nhiều ảnh.");
  }
  const img = params.images[0];
  try {
    const file = await toFile(img.buffer, "image.png", { type: "image/png" });
    const response = await client.images.edit({
      model: config.model,
      image: file,
      prompt: params.prompt,
      size: `${params.width}x${params.height}` as "1024x1024",
      quality: params.quality === "high" ? "high" : "medium",
    });
    return extractOpenAIImage(response, config.model);
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
        return await chatCompletionsEdit(client, config.model, params);
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

async function chatCompletionsGenerate(client: OpenAI, model: string, params: GenerateParams): Promise<GeneratedImage> {
  const prefix = buildImageInstructionPrefix(params);
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: `${prefix}${params.prompt}` }],
    max_tokens: 4096,
  });
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
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content }],
    max_tokens: 4096,
  });
  return extractChatImage(response, model);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractChatImage(response: any, modelName: string): GeneratedImage {
  const message = response.choices?.[0]?.message;
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
  throw new Error("Provider không trả về ảnh qua chat completions");
}

function parseDataUrl(url: string, modelName: string): GeneratedImage {
  const match = url.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (match) {
    return { data: Buffer.from(match[2], "base64"), mimeType: match[1], model: modelName };
  }
  throw new Error("Provider trả về định dạng ảnh không hỗ trợ");
}

async function extractOpenAIImage(response: OpenAI.Images.ImagesResponse, modelName: string): Promise<GeneratedImage> {
  const item = response.data?.[0];
  if (!item) throw new Error("Provider không trả về ảnh");
  if (item.b64_json) {
    return { data: Buffer.from(item.b64_json, "base64"), mimeType: "image/png", model: modelName };
  }
  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error("Không tải được ảnh từ URL provider trả về");
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "image/png";
    return { data: buf, mimeType: mime, model: modelName };
  }
  throw new Error("Provider không trả về ảnh");
}

async function geminiGenerate(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage> {
  const ai = new GoogleGenAI({ apiKey: config.api_key });
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
}

async function geminiEdit(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  const ai = new GoogleGenAI({ apiKey: config.api_key });
  const parts = [
    ...params.images.map((img) => ({
      inlineData: { mimeType: img.mimeType || "image/png", data: img.buffer.toString("base64") },
    })),
    { text: params.prompt },
  ];
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
}

function extractNewGeminiImage(response: { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> }, modelName: string): GeneratedImage {
  const parts = response.candidates?.[0]?.content?.parts;
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
  }
  throw new Error("Gemini không trả về ảnh");
}
