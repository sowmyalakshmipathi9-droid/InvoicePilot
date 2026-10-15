import { describe, expect, it } from "vitest";
import { extractInvoiceRequest, getExtractionStatus } from "../src/lib/extract-api";

describe("extraction API", () => {
  it("reports the configured model and processing location", () => {
    expect(getExtractionStatus({ baseUrl: "http://localhost:11434", model: "test-model" })).toEqual({
      model: "test-model",
      processingLocation: "local",
    });
  });

  it("validates extraction input before contacting Ollama", async () => {
    const result = await extractInvoiceRequest({ text: "too short" });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Paste at least 20 characters of invoice text (up to 30,000).",
    });
  });
});
