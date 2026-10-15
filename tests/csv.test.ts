import { describe, expect, it } from "vitest";
import { expensesToCsv } from "../src/lib/csv";
import type { ExpenseRecord } from "../src/lib/csv";
import { createEmptyExtraction } from "../src/lib/invoice";

describe("expensesToCsv", () => {
  it("escapes quotes, commas, and newlines and preserves empty values", () => {
    const record: ExpenseRecord = {
      ...createEmptyExtraction(),
      id: "expense-1",
      vendor: 'Studio "Bright", Inc.\nWest',
      currency: "USD",
      subtotal: 100,
      tax: 25.5,
      total: 125.5,
      category: "Software",
      description: "Hosting plan",
      confidence: "high",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const csv = expensesToCsv([record]);
    expect(csv).toContain('"Studio ""Bright"", Inc.\nWest"');
    expect(csv).toContain(",USD,");
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toMatch(/^ID,Vendor,/);
  });
});