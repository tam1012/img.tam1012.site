import OpenAI, { toFile } from "openai";
import type { ImageProvider, GenerateParams, EditParams, GeneratedImage } from "./index";

const SIZE_MAP: Record<string, string> = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

export class OpenAIProvider implements ImageProvider {
  name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(params: GenerateParams): Promise<GeneratedImage> {
    const response = await this.client.images.generate({
      model: "gpt-image-1",
      prompt: params.prompt,
      size: SIZE_MAP[params.size] as "1024x1024" | "1536x1024" | "1024x1536",
      quality: params.quality === "high" ? "high" : "medium",
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI không trả về ảnh");

    return {
      data: Buffer.from(b64, "base64"),
      mimeType: "image/png",
      model: "gpt-image-1",
    };
  }

  async edit(params: EditParams): Promise<GeneratedImage> {
    const file = await toFile(params.image, "image.png", { type: "image/png" });

    const response = await this.client.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt: params.prompt,
      size: SIZE_MAP[params.size] as "1024x1024" | "1536x1024" | "1024x1536",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI không trả về ảnh chỉnh sửa");

    return {
      data: Buffer.from(b64, "base64"),
      mimeType: "image/png",
      model: "gpt-image-1",
    };
  }
}
