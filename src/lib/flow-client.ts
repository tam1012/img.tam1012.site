import {
  resolveFlowImageRoute,
  resolveFlowVideoRoute,
  type FlowRoute,
} from "./flow-routing";

export type FlowImageResult = {
  b64_json: string;
};

function activeRoute(route: FlowRoute): Extract<FlowRoute, { route: "cpa" | "direct" }> | null {
  if (route.route === "disabled") return null;
  return route;
}

function aspectToSize(aspectRatio?: string, width?: number, height?: number): string {
  // Prefer explicit UI aspect ratio — Flow maps 5 enums from these labels.
  const a = (aspectRatio || "").trim();
  if (a === "1:1" || a === "16:9" || a === "9:16" || a === "4:3" || a === "3:4") return a;
  // Near-ratios still useful as size hint for bridge nearest-bucket fallback
  if (a === "2:3" || a === "3:2") return a;
  if (width && height) return `${width}x${height}`;
  return "1:1";
}


function normalizeFlowResolution(resolution?: string): "1K" | "2K" | "4K" {
  const r = (resolution || "1K").trim().toUpperCase();
  if (r === "2K" || r === "2") return "2K";
  // Flow UI max download often 2K; bridge still accepts 4K enum if model supports.
  if (r === "4K" || r === "4") return "4K";
  return "1K";
}


async function parseFlowImageResponse(res: Response): Promise<FlowImageResult[]> {
  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: { message?: string; code?: string } };
      detail = err.error?.message || err.error?.code || "";
    } catch {
      detail = "";
    }
    throw new Error(
      detail
        ? `FLOW_UPSTREAM_HTTP_${res.status}: ${detail.slice(0, 160)}`
        : `FLOW_UPSTREAM_HTTP_${res.status}`,
    );
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const images = (json.data ?? [])
    .map((item) => item.b64_json)
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((b64_json) => ({ b64_json }));
  if (images.length === 0) throw new Error("FLOW_UPSTREAM_EMPTY");
  return images;
}

export async function generateFlowImageViaRoute(input: {
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  n?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<FlowImageResult[]> {
  const env = input.env ?? process.env;
  const route = activeRoute(resolveFlowImageRoute(env));
  if (!route) {
    throw new Error("FLOW_DISABLED");
  }
  const model = (input.model || route.model || "flow-nano-banana-2").trim();
  const size = input.size || aspectToSize(input.aspectRatio, input.width, input.height);
  const resolution = normalizeFlowResolution(input.resolution);
  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(`${route.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      size,
      resolution,
      n: input.n ?? 1,
      response_format: "b64_json",
    }),
  });
  return parseFlowImageResponse(res);
}

/** Edit / image-to-image via Flow bridge. Supports Nano Banana 2 + Pro. */
export async function editFlowImageViaRoute(input: {
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  n?: number;
  images: Array<{ buffer: Buffer; mimeType?: string }>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<FlowImageResult[]> {
  const env = input.env ?? process.env;
  const route = activeRoute(resolveFlowImageRoute(env));
  if (!route) {
    throw new Error("FLOW_DISABLED");
  }
  if (!input.images?.length) {
    throw new Error("FLOW_INVALID_REQUEST");
  }
  const model = (input.model || route.model || "flow-nano-banana-2").trim();
  const size = input.size || aspectToSize(input.aspectRatio, input.width, input.height);
  const resolution = normalizeFlowResolution(input.resolution);
  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(`${route.baseUrl}/images/edits`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      size,
      resolution,
      n: input.n ?? 1,
      response_format: "b64_json",
      images: input.images.map((img) => ({
        b64_json: img.buffer.toString("base64"),
        mime_type: img.mimeType || "image/png",
      })),
    }),
  });
  return parseFlowImageResponse(res);
}


export async function createFlowVideoViaRoute(input: {
  prompt: string;
  model?: string;
  duration?: 4 | 6 | 8 | 10;
  aspectRatio?: "16:9" | "9:16";
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ request_id: string }> {
  const env = input.env ?? process.env;
  const route = activeRoute(resolveFlowVideoRoute(env));
  if (!route) throw new Error("FLOW_DISABLED");
  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(`${route.baseUrl}/videos/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model || route.model,
      prompt: input.prompt,
      duration: input.duration ?? 4,
      aspect_ratio: input.aspectRatio ?? "16:9",
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: { message?: string; code?: string } };
      detail = err.error?.message || err.error?.code || "";
    } catch { detail = ""; }
    throw new Error(
      detail
        ? `FLOW_UPSTREAM_HTTP_${res.status}: ${detail.slice(0, 160)}`
        : `FLOW_UPSTREAM_HTTP_${res.status}`,
    );
  }
  const json = (await res.json()) as { request_id?: string };
  if (!json.request_id) throw new Error("FLOW_UPSTREAM_EMPTY");
  return { request_id: json.request_id };
}

export async function pollFlowVideoViaRoute(input: {
  requestId: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "pending" | "done" | "failed"; progress?: number; error?: string }> {
  const env = input.env ?? process.env;
  const route = activeRoute(resolveFlowVideoRoute(env));
  if (!route) throw new Error("FLOW_DISABLED");
  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(`${route.baseUrl}/videos/${input.requestId}`, {
    headers: { Authorization: `Bearer ${route.apiKey}` },
  });
  if (!res.ok) throw new Error(`FLOW_UPSTREAM_HTTP_${res.status}`);
  const json = (await res.json()) as { status: string; progress?: number; error?: string };
  return {
    status: json.status === "done" ? "done" : json.status === "failed" ? "failed" : "pending",
    progress: json.progress,
    error: json.error,
  };
}

export async function downloadFlowVideoContentViaRoute(input: {
  requestId: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const env = input.env ?? process.env;
  const route = activeRoute(resolveFlowVideoRoute(env));
  if (!route) throw new Error("FLOW_DISABLED");
  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(`${route.baseUrl}/videos/${input.requestId}/content`, {
    headers: { Authorization: `Bearer ${route.apiKey}` },
  });
  if (!res.ok) throw new Error(`FLOW_UPSTREAM_HTTP_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
