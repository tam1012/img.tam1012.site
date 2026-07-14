import { describe, expect, it } from "vitest";
import { findChromePath } from "./find-chrome.js";

const PF = "C:\\Program Files";
const PF86 = "C:\\Program Files (x86)";
const LOCAL = "C:\\Users\\tester\\AppData\\Local";

const env = {
  PROGRAMFILES: PF,
  "PROGRAMFILES(X86)": PF86,
  LOCALAPPDATA: LOCAL,
};

describe("findChromePath", () => {
  it("prefers explicit FLOW_CHROME_PATH when it exists", () => {
    const found = findChromePath(
      { ...env, FLOW_CHROME_PATH: "D:\\custom\\chrome.exe" },
      (p) => p === "D:\\custom\\chrome.exe",
    );
    expect(found).toBe("D:\\custom\\chrome.exe");
  });

  it("falls back to Program Files install", () => {
    const target = `${PF}\\Google\\Chrome\\Application\\chrome.exe`;
    expect(findChromePath(env, (p) => p === target)).toBe(target);
  });

  it("checks candidates in priority order", () => {
    const pf86 = `${PF86}\\Google\\Chrome\\Application\\chrome.exe`;
    const local = `${LOCAL}\\Google\\Chrome\\Application\\chrome.exe`;
    // Both x86 and local exist; x86 wins because it comes first.
    expect(findChromePath(env, (p) => p === pf86 || p === local)).toBe(pf86);
  });

  it("returns null when no candidate exists", () => {
    expect(findChromePath(env, () => false)).toBeNull();
  });
});
