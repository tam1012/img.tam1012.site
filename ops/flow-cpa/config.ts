export const FLOW_PROVIDER_NAME = "google-flow-bridge";

export type CompatModel = {
  name: string;
  alias?: string;
  "display-name"?: string;
  image?: boolean;
};

export type CompatProvider = {
  name: string;
  disabled?: boolean;
  "base-url": string;
  "api-key-entries"?: Array<{ "api-key": string }>;
  models: CompatModel[];
  [key: string]: unknown;
};

function assertKey(value: string, label: string): void {
  if (value.length < 32 || /[\r\n]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

export function upsertFlowProvider(items: CompatProvider[], bridgeKey: string): CompatProvider[] {
  assertKey(bridgeKey, "bridge key");
  const flow: CompatProvider = {
    name: FLOW_PROVIDER_NAME,
    disabled: false,
    "base-url": "http://google-media-bridge:8460/v1",
    "api-key-entries": [{ "api-key": bridgeKey }],
    models: [
      {
        name: "flow-nano-banana-2",
        alias: "flow-nano-banana-2",
        "display-name": "Google Flow Nano Banana 2",
        image: true,
      },
    ],
  };
  return [...items.filter((item) => item.name !== FLOW_PROVIDER_NAME), flow];
}

export function removeFlowProvider(items: CompatProvider[]): CompatProvider[] {
  return items.filter((item) => item.name !== FLOW_PROVIDER_NAME);
}
