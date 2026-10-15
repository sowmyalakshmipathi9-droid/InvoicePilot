import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractInvoiceRequest, getExtractionStatus } from "../src/lib/extract-api";
import { listExpenses, saveExpense } from "../src/lib/expense-store";

describe("extraction API", () => {
  beforeEach(async () => {
    for (const database of await indexedDB.databases()) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the configured model and processing location", () => {
    expect(getExtractionStatus({ baseUrl: "http://localhost:11434", model: "test-model" })).toEqual({
      model: "test-model",
      processingLocation: "local",
      mode: "live",
      authenticationRequired: false,
    });
  });

  it("validates extraction input before contacting Ollama", async () => {
    const result = await extractInvoiceRequest({ text: "too short" });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "Paste at least 20 characters of invoice text (up to 30,000).",
    });
  });

  it("returns a live draft without saving it until the explicit approval save", async () => {
    const extraction = {
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
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "mock-model",
      message: { content: JSON.stringify(extraction) },
    }))));

    const result = await extractInvoiceRequest(
      { text: "A realistic invoice text that is long enough." },
      { baseUrl: "http://127.0.0.1:11434", model: "mock-model" },
    );

    expect(result.status).toBe(200);
    expect(await listExpenses()).toEqual([]);
    await saveExpense(result.body.extraction);
    expect(await listExpenses()).toHaveLength(1);
  });
});
