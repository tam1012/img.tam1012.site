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
  if (width && height) return `${width}x${height}`;
  const a = (aspectRatio || "1:1").trim();
  if (a === "9:16" || a === "3:4" || a === "2:3") return "1024x1792";
  if (a === "16:9" || a === "4:3" || a === "3:2") return "1792x1024";
  return "1024x1024";
}

export async function generateFlowImageViaRoute(input: {
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
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
      n: input.n ?? 1,
      response_format: "b64_json",
    }),
  });
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

export async function createFlowVideoViaRoute(input: {
  prompt: string;
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
      model: route.model,
      prompt: input.prompt,
      duration: input.duration ?? 4,
      aspect_ratio: input.aspectRatio ?? "16:9",
    }),
  });
  if (!res.ok) throw new Error(`FLOW_UPSTREAM_HTTP_${res.status}`);
  const json = (await res.json()) as { request_id?: string };
  if (!json.request_id) throw new Error("FLOW_UPSTREAM_EMPTY");
  return { request_id: json.request_id };
}
