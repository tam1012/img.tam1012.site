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

export interface ImageProvider {
  name: string;
  generate(params: GenerateParams): Promise<GeneratedImage>;
  edit(params: EditParams): Promise<GeneratedImage>;
}

import { OpenAIProvider } from "./openai";
import { GoogleProvider } from "./google";

const providers: Record<string, () => ImageProvider | null> = {
  openai: () => {
    const key = process.env.OPENAI_API_KEY;
    return key ? new OpenAIProvider(key) : null;
  },
  google: () => {
    const key = process.env.GOOGLE_AI_API_KEY;
    return key ? new GoogleProvider(key) : null;
  },
};

export function getProvider(name: string): ImageProvider {
  const factory = providers[name];
  if (!factory) throw new Error(`Provider không hỗ trợ: ${name}`);
  const provider = factory();
  if (!provider) throw new Error(`Chưa cấu hình API key cho ${name}`);
  return provider;
}

export function getAvailableProviders(): string[] {
  return Object.entries(providers)
    .filter(([, factory]) => factory() !== null)
    .map(([name]) => name);
}
