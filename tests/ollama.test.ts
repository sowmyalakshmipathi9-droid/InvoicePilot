import { describe, expect, it, vi } from "vitest";
import { extractWithOllama, OllamaError } from "../src/lib/ollama";

const config = { baseUrl: "http://127.0.0.1:11434", model: "gemma3:4b" };
const modelJson = JSON.stringify({
  vendor: "Northstar Hosting",
  invoiceNumber: "NS-2041",
  invoiceDate: "2026-09-04",
  currency: "USD",
  subtotal: 24,
  tax: 2.16,
  total: 26.16,
  category: "Software",
  description: "Monthly web hosting",
  confidence: "high",
  missingFields: [],
  reasoning: "Recurring web hosting is a software service.",
});

describe("Ollama extraction", () => {
  it("sends the configured model and validates its response", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: config.model,
      message: { content: modelJson },
    })));
    const result = await extractWithOllama("A realistic invoice text that is long enough.", config, request);
    expect(result.model).toBe(config.model);
    expect(result.extraction.total).toBe(26.16);
    expect(JSON.parse(request.mock.calls[0][1].body).model).toBe(config.model);
  });

  it("reports invalid JSON and unreachable services without exposing invoice text", async () => {
    const invalidJson = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: config.model,
      message: { content: "not json" },
    })));
    await expect(extractWithOllama("private invoice text", config, invalidJson))
      .rejects.toThrow(/not valid JSON/);

    const unavailable = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(extractWithOllama("private invoice text", config, unavailable))
      .rejects.toThrow(OllamaError);
  });
});