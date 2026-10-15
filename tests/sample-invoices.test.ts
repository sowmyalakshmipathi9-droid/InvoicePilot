import { describe, expect, it } from "vitest";
import { getFinancialWarnings, invoiceExtractionSchema, parseModelExtraction } from "../src/lib/invoice";
import { SAMPLE_INVOICES } from "../src/lib/sample-invoices";

describe("fictional invoice samples", () => {
  it("provides five clearly labeled, valid fictional invoices with reconciled line items and tax", () => {
    expect(SAMPLE_INVOICES).toHaveLength(5);

    for (const sample of SAMPLE_INVOICES) {
      expect(sample.text).toContain("SAMPLE — NOT A REAL INVOICE");
      expect(sample.text).toContain("@");
      expect(sample.text).toContain("Due date:");
      expect(sample.text).toMatch(/Payment terms:/);

      const lineItemSubtotal = sample.lineItems.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      );
      expect(sample.extraction.subtotal).toBe(lineItemSubtotal);
      expect(sample.extraction.tax).toBe(Math.round(lineItemSubtotal * sample.taxRate * 100) / 100);
      expect(sample.extraction.total).toBe(
        Math.round((lineItemSubtotal + (sample.extraction.tax ?? 0)) * 100) / 100,
      );
      expect(getFinancialWarnings(sample.extraction)).toEqual([]);
      expect(invoiceExtractionSchema.parse(sample.extraction)).toEqual(sample.extraction);
      expect(parseModelExtraction(sample.extraction)).toMatchObject(sample.extraction);
    }
  });

  it("covers all requested invoice types", () => {
    expect(SAMPLE_INVOICES.map(({ label }) => label)).toEqual([
      "Freelance web development",
      "Graphic design project",
      "Software subscription",
      "Office supplies purchase",
      "Consulting service",
    ]);
  });
});
