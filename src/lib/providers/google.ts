import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ImageProvider, GenerateParams, EditParams, GeneratedImage } from "./index";

export class GoogleProvider implements ImageProvider {
  name = "google";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(params: GenerateParams): Promise<GeneratedImage> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
      } as never,
    });

    const result = await model.generateContent(params.prompt);
    return this.extractImage(result, "gemini-2.0-flash-exp");
  }

  async edit(params: EditParams): Promise<GeneratedImage> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
      } as never,
    });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: params.imageMimeType || "image/png",
          data: params.image.toString("base64"),
        },
      },
      { text: params.prompt },
    ]);

    return this.extractImage(result, "gemini-2.0-flash-exp");
  }

  private extractImage(
    result: { response: { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }> } },
    modelName: string
  ): GeneratedImage {
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
    throw new Error("Google Gemini không trả về ảnh");
  }
}
