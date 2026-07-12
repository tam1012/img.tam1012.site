import OpenAI from "openai";

const DEFAULT_MODEL = "gemini-3-flash-agent";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_INPUT_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 4_000;

interface RefineContext {
  aspectRatio?: string;
  resolution?: string;
  mode?: "generate" | "edit" | "video";
}

export function promptRefineConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsedTimeout = Number(env.PROMPT_REFINE_TIMEOUT_MS);
  return {
    baseUrl: env.PROMPT_REFINE_BASE_URL?.trim() || "",
    apiKey: env.PROMPT_REFINE_API_KEY?.trim() || "",
    model: env.PROMPT_REFINE_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? Math.min(parsedTimeout, 30_000)
      : DEFAULT_TIMEOUT_MS,
  };
}

export function buildPromptRefineMessages(prompt: string, context: RefineContext = {}) {
  const modeInstruction = context.mode === "edit"
    ? "This is an image edit prompt. Strengthen only the requested change and explicitly preserve everything that should remain unchanged."
    : context.mode === "video"
      ? "This is a video generation prompt. Clarify subject motion, camera movement, timing, and scene continuity only when relevant."
      : "This is an image generation prompt.";
  const system = [
    "You improve prompts for image generation.",
    modeInstruction,
    "Return only the improved prompt as plain text. Do not explain and do not use Markdown.",
    "Keep the same language as the user's original prompt. Do not translate it.",
    "Preserve the user's intent, names, quoted text, quantities, colors, cultural details, and constraints.",
    "Only add details that clarify an ambiguity. Do not automatically add cameras, lenses, lighting, art styles, artists, brands, or quality buzzwords.",
    "If the prompt is already clear, make only minimal edits.",
  ].join(" ");
  const metadata = [
    context.aspectRatio ? `Aspect ratio: ${context.aspectRatio}` : "",
    context.resolution ? `Resolution: ${context.resolution}` : "",
  ].filter(Boolean).join("; ");

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: metadata ? `${metadata}\n\n${prompt}` : prompt },
  ];
}

export function cleanRefinedPrompt(value: string): string {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("“") && cleaned.endsWith("”"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (!cleaned) throw new Error("Prompt cải thiện bị rỗng");
  if (cleaned.length > MAX_OUTPUT_CHARS) throw new Error("Prompt cải thiện quá dài");
  return cleaned;
}

export async function refinePrompt(prompt: string, context: RefineContext = {}): Promise<string> {
  const input = prompt.trim();
  if (!input) throw new Error("Vui lòng nhập mô tả");
  if (input.length > MAX_INPUT_CHARS) throw new Error(`Prompt tối đa ${MAX_INPUT_CHARS} ký tự`);

  const config = promptRefineConfig();
  if (!config.baseUrl || !config.apiKey) {
    throw new Error("Tính năng cải thiện prompt chưa được cấu hình");
  }

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: buildPromptRefineMessages(input, context),
      temperature: 0.3,
      max_tokens: 1200,
    }, { signal: controller.signal });
    return cleanRefinedPrompt(response.choices[0]?.message?.content || "");
  } finally {
    clearTimeout(timeout);
  }
}
