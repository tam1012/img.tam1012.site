function yamlScalar(value: string): string {
  if (!value || /[\r\n]/.test(value)) throw new Error("Invalid YAML scalar");
  return JSON.stringify(value);
}

export function renderSidecarConfig(input: { clientKey: string; bridgeKey: string }): string {
  return [
    "host: 0.0.0.0",
    "port: 8317",
    "remote-management:",
    "  allow-remote: false",
    "  disable-control-panel: true",
    "logging-to-file: false",
    "usage-statistics-enabled: false",
    "request-retry: 0",
    "api-keys:",
    `  - ${yamlScalar(input.clientKey)}`,
    "xai-api-key:",
    `  - api-key: ${yamlScalar(input.bridgeKey)}`,
    "    base-url: http://google-media-bridge:8460/v1",
    "    disable-cooling: true",
    "    models:",
    "      - name: grok-imagine-video",
    "        alias: flow-video-fast-4s",
  ].join("\n");
}
