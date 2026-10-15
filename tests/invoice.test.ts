import { describe, expect, it } from "vitest";
import { getFinancialWarnings, parseModelExtraction } from "../src/lib/invoice";

const validModelOutput = {
  vendor: "Northstar Hosting",
  invoiceNumber: "NS-2041",
  invoiceDate: "2026-09-04",
  currency: "usd",
  subtotal: 24,
  tax: 2.16,
  total: 26.16,
  category: "Software",
  description: "Monthly web hosting",
  confidence: "high",
  missingFields: [],
  reasoning: "Recurring web hosting is a software service.",
};

describe("parseModelExtraction", () => {
  it("normalizes a valid result and keeps only validated fields", () => {
    expect(parseModelExtraction(validModelOutput)).toMatchObject({
      vendor: "Northstar Hosting",
      currency: "USD",
      total: 26.16,
      missingFields: [],
    });
  });

  it("keeps omitted fields missing instead of inventing values", () => {
    const result = parseModelExtraction({ category: "Other", total: 10 });
    expect(result.total).toBe(10);
    expect(result.subtotal).toBeNull();
    expect(result.vendor).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.missingFields).toContain("subtotal");
  });

  it("rejects malformed dates, negative amounts, and unexpected categories", () => {
    expect(() => parseModelExtraction({ ...validModelOutput, invoiceDate: "2026-02-30" })).toThrow();
    expect(() => parseModelExtraction({ ...validModelOutput, total: -1 })).toThrow();
    expect(() => parseModelExtraction({ ...validModelOutput, category: "Tax advice" })).toThrow();
  });

  it("flags amount inconsistencies but accepts rounding differences", () => {
    expect(getFinancialWarnings(parseModelExtraction({ ...validModelOutput, total: 30 }))).toHaveLength(1);
    expect(getFinancialWarnings(parseModelExtraction({ ...validModelOutput, total: 26.17 }))).toEqual([]);
  });

  it("rejects a malformed extraction payload", () => {
    expect(() => parseModelExtraction("{vendor: Papertrail}")).toThrow();
  });
});