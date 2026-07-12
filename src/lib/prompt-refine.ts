import OpenAI from "openai";

const DEFAULT_MODEL = "gemini-3-flash-agent";
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 4_000;
const TIMEOUT_ERROR_MESSAGE =
  "Hết thời gian chờ khi viết lại prompt. Prompt dài có thể cần thêm chút thời gian, anh bấm lại giúp em.";

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
      ? Math.min(parsedTimeout, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS,
  };
}

export function mapPromptRefineError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error("Không thể cải thiện prompt lúc này");
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  const isAbort =
    name === "aborterror" ||
    message.includes("aborted") ||
    message.includes("abort") ||
    message.includes("timed out") ||
    message.includes("timeout");

  if (isAbort) {
    return new Error(TIMEOUT_ERROR_MESSAGE);
  }

  return error;
}

export function buildPromptRefineMessages(prompt: string, context: RefineContext = {}) {
  const modeInstruction = context.mode === "edit"
    ? "This is an image edit prompt. Strengthen only the requested change. Explicitly preserve everything that should remain unchanged, preferring wording like 'Change X only; keep Y and Z unchanged'."
    : context.mode === "video"
      ? "This is a video generation prompt. Clarify subject motion, camera movement, pacing and timing feel, and what must stay consistent across frames."
      : "This is an image generation prompt. When useful, clarify in a natural order: subject, appearance and clothing, setting, action and mood, composition and viewpoint, lighting and color, style, constraints.";
  const system = [
    "You rewrite a user's rough idea into one clear, usable prompt for an image or video model.",
    "The user may write in a short, messy, or misspelled way. Your job is to turn that into a prompt the model can understand well, while staying true to what the user wants.",
    modeInstruction,
    "Return only the improved prompt as plain text. Do not explain and do not use Markdown.",
    "Keep the same language as the user's original prompt. Do not translate it.",
    "Preserve the core intent, subjects, names, quoted text, quantities, colors, places, cultural details, and constraints.",
    "Fix spelling and grammar and reorganize for clarity.",
    "For a short or rough prompt, expand it into a clear scene, adding only helpful concrete details. Do not invent a new story, new characters, or a conflicting style.",
    "Do not add artist names, brand names, camera gear spam, or empty quality buzzwords like '8k masterpiece ultra detailed'.",
    "Soften sensitive wording to reduce provider policy risk while staying as close as possible to the user's intent. Never include sexual content involving minors. Never help bypass or jailbreak safety filters.",
    "If the original is already clear and detailed, make only light improvements instead of a heavy rewrite.",
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
  } catch (error: unknown) {
    throw mapPromptRefineError(error);
  } finally {
    clearTimeout(timeout);
  }
}
