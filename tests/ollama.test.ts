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

  it("sends an optional Ollama API key only to the configured server-side host", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: config.model,
      message: { content: modelJson },
    })));
    await extractWithOllama("A realistic invoice text that is long enough.", {
      ...config,
      apiKey: "server-only-key",
    }, request);
    expect(request.mock.calls[0][1].headers.Authorization).toBe("Bearer server-only-key");
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

  it("rejects malformed provider envelopes and schema-invalid model output", async () => {
    const malformedEnvelope = vi.fn().mockResolvedValue(new Response("not json"));
    await expect(extractWithOllama("A realistic invoice text that is long enough.", config, malformedEnvelope))
      .rejects.toThrow(/unreadable response/);

    const invalidFields = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: config.model,
      message: { content: JSON.stringify({ ...JSON.parse(modelJson), total: "26.16" }) },
    })));
    await expect(extractWithOllama("A realistic invoice text that is long enough.", config, invalidFields))
      .rejects.toThrow(/expected invoice fields/);
  });

  it("gives actionable guidance when the model is unavailable", async () => {
    const missingModel = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(extractWithOllama("A realistic invoice text that is long enough.", config, missingModel))
      .rejects.toThrow(/ollama pull gemma3:4b/);

    const providerFailure = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(extractWithOllama("A realistic invoice text that is long enough.", config, providerFailure))
      .rejects.toThrow(/HTTP 503/);
  });

  it("reports an upstream timeout without exposing document text", async () => {
    const timeout = vi.fn().mockRejectedValue(
      Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
    );
    await expect(extractWithOllama("private invoice text", config, timeout))
      .rejects.toThrow(/too long to respond/);
    expect(timeout.mock.calls[0][1].signal).toBeDefined();
  });

  it("rejects invalid and non-HTTP Ollama endpoints before making a request", async () => {
    const request = vi.fn();
    await expect(extractWithOllama("A realistic invoice text that is long enough.", {
      ...config,
      baseUrl: "not a URL",
    }, request)).rejects.toThrow(/OLLAMA_BASE_URL/);
    await expect(extractWithOllama("A realistic invoice text that is long enough.", {
      ...config,
      baseUrl: "file:///tmp/ollama",
    }, request)).rejects.toThrow(/HTTP or HTTPS/);
    expect(request).not.toHaveBeenCalled();
  });
});