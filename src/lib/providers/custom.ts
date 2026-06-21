import OpenAI, { toFile } from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ProviderConfig } from "../db";

export interface GenerateParams {
  prompt: string;
  size: "square" | "landscape" | "portrait";
  quality: "standard" | "high";
}

export interface EditParams {
  image: Buffer;
  imageMimeType: string;
  prompt: string;
  size: "square" | "landscape" | "portrait";
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  model: string;
}

const OPENAI_SIZE_MAP: Record<string, string> = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

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
  const response = await client.images.generate({
    model: config.model,
    prompt: params.prompt,
    size: OPENAI_SIZE_MAP[params.size] as "1024x1024" | "1536x1024" | "1024x1536",
    quality: params.quality === "high" ? "high" : "medium",
    n: 1,
  });
  return extractOpenAIImage(response, config.model);
}

async function openaiEdit(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  const client = new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url || undefined,
  });
  const file = await toFile(params.image, "image.png", { type: "image/png" });
  const response = await client.images.edit({
    model: config.model,
    image: file,
    prompt: params.prompt,
    size: OPENAI_SIZE_MAP[params.size] as "1024x1024" | "1536x1024" | "1024x1536",
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("Provider không trả về ảnh chỉnh sửa");
  return { data: Buffer.from(b64, "base64"), mimeType: "image/png", model: config.model };
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
  const genAI = new GoogleGenerativeAI(config.api_key);
  const model = genAI.getGenerativeModel({
    model: config.model,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });
  const result = await model.generateContent(params.prompt);
  return extractGeminiImage(result, config.model);
}

async function geminiEdit(config: ProviderConfig, params: EditParams): Promise<GeneratedImage> {
  const genAI = new GoogleGenerativeAI(config.api_key);
  const model = genAI.getGenerativeModel({
    model: config.model,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });
  const result = await model.generateContent([
    { inlineData: { mimeType: params.imageMimeType || "image/png", data: params.image.toString("base64") } },
    { text: params.prompt },
  ]);
  return extractGeminiImage(result, config.model);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGeminiImage(result: any, modelName: string): GeneratedImage {
  const parts = result.response.candidates?.[0]?.content?.parts;
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
