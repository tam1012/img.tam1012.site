import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright-core";
import { decryptEnrollment, type EncryptedEnrollment } from "../security/enrollment.js";
import { createRecaptchaToken } from "../flow/token-factory.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const SESSION_ENDPOINT = "/fx/api/auth/session";
const IMAGE_ENDPOINT_TEMPLATE =
  "https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages";

// Observed from Flow page capture (Phase 1). Body keys:
// imageAspectRatio, imageInputs, imageModelName, recaptchaToken, structuredPrompt
// Observed in Flow/_app bundle: grecaptcha action for image gen is IMAGE_GENERATION.
const DEFAULT_ACTIONS = [
  "IMAGE_GENERATION",
  "FLOW_GENERATION",
  "FLOW_GENERATE",
  "generate",
  "GENERATE",
  "submit",
];

function log(message: string) {
  process.stderr.write(`${message}\n`);
}

type MetaFile = {
  siteKey?: string | null;
  action?: string | null;
  pathTemplate?: string;
  bodyKeys?: string[];
};

async function loadMeta(): Promise<MetaFile | null> {
  const file = process.env.FLOW_META_FILE;
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as MetaFile;
  } catch {
    return null;
  }
}

async function loadProjectId(): Promise<string | undefined> {
  if (process.env.FLOW_PROJECT_ID) return process.env.FLOW_PROJECT_ID;
  const file = process.env.FLOW_PROJECT_ID_FILE;
  if (!file) return undefined;
  try {
    return (await readFile(file, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

// The Bearer token and project ID never cross into Node. The upstream image
// request is issued from inside the page origin and only counts/status return.
async function runDirectImage(
  page: Page,
  recaptchaToken: string,
  projectId: string,
): Promise<{ status: number; count: number; bytes: number; err: string | null }> {
  return page.evaluate(
    async ([sessionEndpoint, endpointTemplate, token, project]) => {
      const sessionRes = await fetch(sessionEndpoint, { credentials: "include" });
      if (!sessionRes.ok) {
        return { status: sessionRes.status, count: 0, bytes: 0, err: "session_http" };
      }
      const session = (await sessionRes.json()) as { access_token?: string };
      const bearer = session?.access_token;
      if (!bearer) return { status: 401, count: 0, bytes: 0, err: "no_bearer" };

      const endpoint = endpointTemplate.replace("{projectId}", project);
      // Real Flow/ImageFX body shape from app bundle (not flat fields).
      // Top-level: clientContext, mediaGenerationContext, useNewMedia, requests[].
      // reCAPTCHA lives in clientContext.recaptchaContext.token; action IMAGE_GENERATION.
      const sessionId = crypto.randomUUID?.() || `s-${Date.now()}`;
      const batchId = crypto.randomUUID?.() || `b-${Date.now()}`;
      const seed = Math.floor(Math.random() * 2_000_000_000);
      const clientContext = {
        recaptchaContext: {
          token,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        projectId: project,
        tool: "PINHOLE",
        sessionId,
      };
      const body = {
        clientContext,
        mediaGenerationContext: { batchId },
        useNewMedia: true,
        requests: [
          {
            clientContext,
            imageModelName: "NARWHAL",
            imageAspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
            structuredPrompt: { parts: [{ text: "A RED APPLE ON WHITE BACKGROUND" }] },
            seed,
            imageInputs: [],
          },
        ],
      };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let count = 0;
      let err: string | null = null;
      try {
        const parsed = JSON.parse(raw) as {
          imagePanels?: Array<{ generatedImages?: unknown[] }>;
          media?: unknown[];
          generatedImages?: unknown[];
          responses?: Array<{ generatedImages?: unknown[]; imagePanels?: unknown[] }>;
          error?: { message?: string };
          message?: string;
        };
        count = (parsed.imagePanels ?? []).reduce(
          (sum, panel) => sum + (panel.generatedImages?.length ?? 0),
          0,
        );
        if (count === 0 && Array.isArray(parsed.generatedImages)) {
          count = parsed.generatedImages.length;
        }
        if (count === 0 && Array.isArray(parsed.media)) {
          count = parsed.media.length;
        }
        if (count === 0 && Array.isArray(parsed.responses)) {
          count = parsed.responses.reduce((sum, r) => {
            const n =
              (r.generatedImages?.length ?? 0) +
              (Array.isArray(r.imagePanels) ? r.imagePanels.length : 0);
            return sum + n;
          }, 0);
        }
        // Fallback: any fifeUrl-like string means at least one media.
        if (count === 0 && /fifeUrl|generatedImage|mediaGenerationId/.test(raw)) {
          count = 1;
        }
        err = parsed.error?.message || parsed.message || null;
        if (err) err = String(err).slice(0, 160);
      } catch {
        count = 0;
        err = "non_json";
      }
      return { status: res.status, count, bytes: raw.length, err };
    },
    [SESSION_ENDPOINT, IMAGE_ENDPOINT_TEMPLATE, recaptchaToken, projectId] as const,
  );
}

async function mintToken(page: Page, siteKey: string, preferredAction?: string | null) {
  const actions = [
    ...(preferredAction ? [preferredAction] : []),
    ...DEFAULT_ACTIONS.filter((a) => a !== preferredAction),
  ];
  let lastError: unknown;
  for (const action of actions) {
    try {
      const token = await createRecaptchaToken(page, { siteKey, action });
      return { token, action };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("FLOW_RECAPTCHA_FAILED");
}

async function main() {
  const bundleFile = process.env.FLOW_ENROLLMENT_FILE;
  const privateKeyFile = process.env.FLOW_ENROLLMENT_PRIVATE_KEY_FILE;
  const meta = await loadMeta();
  const siteKey = process.env.FLOW_RECAPTCHA_SITE_KEY ?? meta?.siteKey ?? undefined;
  const preferredAction = process.env.FLOW_RECAPTCHA_ACTION ?? meta?.action ?? null;
  const projectId = await loadProjectId();

  if (!bundleFile) throw new Error("FLOW_ENROLLMENT_FILE is required");
  if (!privateKeyFile) throw new Error("FLOW_ENROLLMENT_PRIVATE_KEY_FILE is required");
  if (!siteKey) throw new Error("FLOW_RECAPTCHA_SITE_KEY is required (or FLOW_META_FILE with siteKey)");
  if (!projectId) throw new Error("FLOW_PROJECT_ID or FLOW_PROJECT_ID_FILE is required");

  const [bundleRaw, privateKeyPem] = await Promise.all([
    readFile(bundleFile, "utf8"),
    readFile(privateKeyFile, "utf8"),
  ]);
  const payload = decryptEnrollment(JSON.parse(bundleRaw) as EncryptedEnrollment, privateKeyPem);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.FLOW_CHROMIUM_PATH ??
        process.env.FLOW_CHROME_PATH ??
        "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      storageState: {
        cookies: payload.storageState.cookies as never,
        origins: payload.storageState.origins as never,
      },
    });
    const page = await context.newPage();
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" });
    // Give grecaptcha time to boot on a cold profile restore.
    await page.waitForTimeout(2500);

    const { token, action } = await mintToken(page, siteKey, preferredAction);
    log(`recaptcha action=${action} tokenLen=${token.length}`);
    const result = await runDirectImage(page, token, projectId);

    if (result.status !== 200 || result.count < 1) {
      throw new Error(
        `upstream status=${result.status} count=${result.count} err=${result.err ?? "none"} bytes=${result.bytes}`,
      );
    }
    process.stdout.write(`FLOW_DIRECT_IMAGE_OK count=${result.count} status=${result.status}\n`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  log(`FLOW_DIRECT_IMAGE_FAILED ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
