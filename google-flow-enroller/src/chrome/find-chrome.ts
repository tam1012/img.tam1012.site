import { existsSync } from "node:fs";

type ChromeEnv = Record<string, string | undefined>;

export function chromeCandidates(env: ChromeEnv): string[] {
  return [
    env.FLOW_CHROME_PATH,
    env.PROGRAMFILES ? `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
    env["PROGRAMFILES(X86)"]
      ? `${env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function findChromePath(
  env: ChromeEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (const candidate of chromeCandidates(env)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}
