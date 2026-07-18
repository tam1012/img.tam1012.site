/** Pure helpers for Flow image-edit probe (no Playwright). */

export type EditProbeKind =
  | "text_generate"
  | "image_edit_generate"
  | "upload"
  | "other_aisandbox";

export type ClassifiedRequest = {
  kind: EditProbeKind;
  /** True when this request is useful for implementing Flow image edit. */
  interesting: boolean;
  reason: string;
  pathTemplate: string;
  bodyKeys: string[];
  nestedShape: Record<string, unknown>;
  imageInputsCount: number;
  imageModelName: string | null;
  hasRecaptcha: boolean;
  contentTypeHint: "json" | "multipart" | "other" | "empty";
  requestFieldKeys: string[];
};

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname.replace(/\/projects\/[^/]+/, "/projects/{projectId}")}`;
  } catch {
    return "(bad-url)";
  }
}

export function pathTemplateOf(raw: string): string {
  try {
    return new URL(raw).pathname.replace(/projects\/[^/]+\//, "projects/{projectId}/");
  } catch {
    return "(bad-path)";
  }
}

/** Redact secrets / long blobs; keep structure for API shape learning. */
export function summarizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return typeof value;
  if (value == null) return value;
  if (typeof value === "string") {
    if (/ya29\.|Bearer\s+/i.test(value)) return "[redacted-token]";
    // Base64 / data-ish blobs
    if (value.length > 120) {
      const looksB64 = /^[A-Za-z0-9+/_=-]+$/.test(value.slice(0, 80));
      return looksB64 ? `blob(len=${value.length})` : `string(len=${value.length})`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const first = summarizeValue(value[0], depth + 1);
    return value.length === 1 ? [first] : [first, `…(+${value.length - 1})`];
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|cookie|email|fifeurl|signedurl|access.?token|refresh.?token/i.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      if (/token/i.test(k) && typeof v === "string") {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = summarizeValue(v, depth + 1);
    }
    return out;
  }
  return typeof value;
}

function isGenerateUrl(url: string): boolean {
  return /aisandbox-pa\.googleapis\.com\/.*(?:batchGenerateImages|flowMedia|GenerateImage|generateImages|batchGenerate)/i.test(
    url,
  );
}

function isUploadUrl(url: string): boolean {
  // Broad: media upload endpoints used by Flow before imageInputs get a mediaId.
  return /aisandbox-pa\.googleapis\.com/i.test(url) &&
    /upload|userMedia|mediaItems|flowMedia:.*[Uu]pload|uploadMedia|writable|resumable/i.test(url);
}

function walkImageInputs(node: unknown): { count: number; samples: unknown[]; requestFieldKeys: string[] } {
  let count = 0;
  const samples: unknown[] = [];
  const requestFieldKeys = new Set<string>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.imageInputs)) {
      count += obj.imageInputs.length;
      if (samples.length === 0 && obj.imageInputs[0] != null) {
        samples.push(summarizeValue(obj.imageInputs[0]));
      }
    }
    if (Array.isArray(obj.requests)) {
      for (const req of obj.requests) {
        if (req && typeof req === "object" && !Array.isArray(req)) {
          for (const k of Object.keys(req as object)) requestFieldKeys.add(k);
        }
      }
    }
    for (const v of Object.values(obj)) visit(v);
  };

  visit(node);
  return { count, samples, requestFieldKeys: [...requestFieldKeys].sort() };
}

function findImageModelName(node: unknown): string | null {
  let found: string | null = null;
  const visit = (value: unknown) => {
    if (found || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.imageModelName === "string") {
      found = obj.imageModelName;
      return;
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(node);
  return found;
}

function hasInlineImageParts(node: unknown): boolean {
  let hit = false;
  const visit = (value: unknown) => {
    if (hit || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (obj.inlineData || obj.fileData || obj.rawImageBytes || obj.imageBytes) {
      hit = true;
      return;
    }
    // media id style references often used after upload
    if (
      (typeof obj.mediaId === "string" && obj.mediaId) ||
      (typeof obj.mediaGenerationId === "string" && obj.mediaGenerationId) ||
      (typeof obj.name === "string" && /media|images\//i.test(obj.name) && Object.keys(obj).length <= 6)
    ) {
      // only count when inside imageInputs-like parent — handled by imageInputsCount mainly
    }
    for (const v of Object.values(obj)) visit(v);
  };
  visit(node);
  return hit;
}

export function classifyAisandboxRequest(
  url: string,
  method: string,
  postData: string | null,
  headers?: Record<string, string> | null,
): ClassifiedRequest {
  const pathTemplate = pathTemplateOf(url);
  const contentType =
    headers?.["content-type"] ||
    headers?.["Content-Type"] ||
    "";
  let contentTypeHint: ClassifiedRequest["contentTypeHint"] = "empty";
  if (/multipart\//i.test(contentType)) contentTypeHint = "multipart";
  else if (/json/i.test(contentType)) contentTypeHint = "json";
  else if (contentType) contentTypeHint = "other";
  else if (postData) contentTypeHint = "other";

  if (method === "OPTIONS") {
    return {
      kind: "other_aisandbox",
      interesting: false,
      reason: "options",
      pathTemplate,
      bodyKeys: [],
      nestedShape: {},
      imageInputsCount: 0,
      imageModelName: null,
      hasRecaptcha: false,
      contentTypeHint,
      requestFieldKeys: [],
    };
  }

  // Upload: often multipart / empty JSON body
  if (isUploadUrl(url) && method !== "GET") {
    let bodyKeys: string[] = [];
    let nestedShape: Record<string, unknown> = {};
    let hasRecaptcha = false;
    if (postData && contentTypeHint !== "multipart") {
      try {
        const parsed = JSON.parse(postData) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          bodyKeys = Object.keys(obj).sort();
          for (const [k, v] of Object.entries(obj)) nestedShape[k] = summarizeValue(v);
          hasRecaptcha = /recaptcha|captcha/i.test(postData);
        }
      } catch {
        nestedShape = { raw: `non-json(len=${postData.length})` };
      }
    } else if (contentTypeHint === "multipart") {
      nestedShape = { multipart: true, approxBytes: postData?.length ?? null };
    }
    return {
      kind: "upload",
      interesting: true,
      reason: "url looks like media upload",
      pathTemplate,
      bodyKeys,
      nestedShape,
      imageInputsCount: 0,
      imageModelName: null,
      hasRecaptcha,
      contentTypeHint,
      requestFieldKeys: [],
    };
  }

  if (isGenerateUrl(url) && method === "POST") {
    let bodyKeys: string[] = [];
    let nestedShape: Record<string, unknown> = {};
    let parsed: unknown = null;
    let hasRecaptcha = false;
    if (postData) {
      try {
        parsed = JSON.parse(postData);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          bodyKeys = Object.keys(obj).sort();
          for (const [k, v] of Object.entries(obj)) nestedShape[k] = summarizeValue(v);
          hasRecaptcha = /recaptcha|captcha/i.test(postData);
        }
      } catch {
        nestedShape = { raw: `non-json(len=${postData.length})` };
      }
    }

    const walked = walkImageInputs(parsed);
    const model = findImageModelName(parsed);
    const inline = hasInlineImageParts(parsed);
    const imageInputsCount = walked.count;
    const isEdit = imageInputsCount > 0 || inline;

    return {
      kind: isEdit ? "image_edit_generate" : "text_generate",
      interesting: isEdit,
      reason: isEdit
        ? imageInputsCount > 0
          ? `imageInputs count=${imageInputsCount}`
          : "inline/file image parts in prompt"
        : "generate with empty imageInputs",
      pathTemplate,
      bodyKeys,
      nestedShape,
      imageInputsCount,
      imageModelName: model,
      hasRecaptcha,
      contentTypeHint: postData ? "json" : contentTypeHint,
      requestFieldKeys: walked.requestFieldKeys,
    };
  }

  // Other aisandbox traffic — not interesting for edit contract
  let bodyKeys: string[] = [];
  if (postData) {
    try {
      const parsed = JSON.parse(postData) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        bodyKeys = Object.keys(parsed as object).sort();
      }
    } catch {
      /* ignore */
    }
  }
  return {
    kind: "other_aisandbox",
    interesting: false,
    reason: "not generate/upload",
    pathTemplate,
    bodyKeys,
    nestedShape: {},
    imageInputsCount: 0,
    imageModelName: null,
    hasRecaptcha: false,
    contentTypeHint,
    requestFieldKeys: [],
  };
}
