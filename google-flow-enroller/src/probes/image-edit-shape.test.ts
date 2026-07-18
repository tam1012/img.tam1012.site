import { describe, expect, it } from "vitest";
import {
  classifyAisandboxRequest,
  pathTemplateOf,
  redactUrl,
  summarizeValue,
} from "./image-edit-shape.js";

const GENERATE_URL =
  "https://aisandbox-pa.googleapis.com/v1/projects/abc-123/flowMedia:batchGenerateImages";

describe("image-edit-shape", () => {
  it("redacts project id in urls", () => {
    expect(redactUrl(GENERATE_URL)).toBe(
      "aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages",
    );
    expect(pathTemplateOf(GENERATE_URL)).toBe(
      "/v1/projects/{projectId}/flowMedia:batchGenerateImages",
    );
  });

  it("summarizes long blobs and redacts tokens", () => {
    expect(summarizeValue("ya29.secret-token-value")).toBe("[redacted-token]");
    expect(summarizeValue("a".repeat(200))).toMatch(/^blob\(len=200\)$|^string\(len=200\)$/);
    expect(summarizeValue({ recaptchaContext: { token: "secret", applicationType: "WEB" } })).toEqual({
      recaptchaContext: { token: "[redacted]", applicationType: "WEB" },
    });
  });

  it("classifies text-only generate as not interesting", () => {
    const body = {
      clientContext: { projectId: "p", tool: "PINHOLE" },
      requests: [
        {
          imageModelName: "GEM_PIX_2",
          structuredPrompt: { parts: [{ text: "a cat" }] },
          imageInputs: [],
        },
      ],
    };
    const c = classifyAisandboxRequest(GENERATE_URL, "POST", JSON.stringify(body));
    expect(c.kind).toBe("text_generate");
    expect(c.interesting).toBe(false);
    expect(c.imageInputsCount).toBe(0);
    expect(c.imageModelName).toBe("GEM_PIX_2");
    expect(c.requestFieldKeys).toContain("imageInputs");
  });

  it("classifies generate with imageInputs as edit", () => {
    const body = {
      clientContext: {
        recaptchaContext: { token: "tok", applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
      },
      requests: [
        {
          imageModelName: "GEM_PIX_2",
          structuredPrompt: { parts: [{ text: "make blue" }] },
          imageInputs: [
            {
              name: "media/xyz",
              imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
              rawImageBytes: "AAAABBBB",
            },
          ],
        },
      ],
    };
    const c = classifyAisandboxRequest(GENERATE_URL, "POST", JSON.stringify(body));
    expect(c.kind).toBe("image_edit_generate");
    expect(c.interesting).toBe(true);
    expect(c.imageInputsCount).toBe(1);
    expect(c.hasRecaptcha).toBe(true);
    expect(c.nestedShape.requests).toBeTruthy();
  });

  it("classifies upload-like urls as interesting upload", () => {
    const url =
      "https://aisandbox-pa.googleapis.com/v1/projects/abc/flowMedia:uploadUserMedia";
    const c = classifyAisandboxRequest(url, "POST", null, {
      "content-type": "multipart/form-data; boundary=----x",
    });
    expect(c.kind).toBe("upload");
    expect(c.interesting).toBe(true);
    expect(c.contentTypeHint).toBe("multipart");
  });
});
