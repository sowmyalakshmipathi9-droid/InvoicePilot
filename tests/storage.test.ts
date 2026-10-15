import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { expensesToCsv } from "../src/lib/csv";
import { filterExpenses, listExpenses, removeExpense, saveExpense } from "../src/lib/expense-store";
import { createEmptyExtraction } from "../src/lib/invoice";
import { SAMPLE_INVOICES } from "../src/lib/sample-invoices";

describe("local expense storage", () => {
  beforeEach(async () => {
    for (const database of await indexedDB.databases()) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
  });

  it("persists, edits, and deletes records", async () => {
    const first = await saveExpense({ ...createEmptyExtraction(), vendor: "Paper Co", total: 18 });
    const edited = await saveExpense({ ...first, vendor: "Paper Company" }, first);
    expect((await listExpenses()).map((expense) => expense.vendor)).toEqual(["Paper Company"]);
    expect(edited.id).toBe(first.id);
    await removeExpense(first.id);
    expect(await listExpenses()).toEqual([]);
  });

  it("filters by vendor, invoice number, and category", async () => {
    const software = await saveExpense({
      ...createEmptyExtraction(),
      vendor: "Northstar Hosting",
      invoiceNumber: "NS-2041",
      category: "Software",
    });
    await saveExpense({ ...createEmptyExtraction(), vendor: "Corner Cafe", category: "Meals" });
    const records = await listExpenses();
    expect(filterExpenses(records, "ns-2041", "All categories")).toEqual([software]);
    expect(filterExpenses(records, "", "Meals")).toHaveLength(1);
  });

  it("keeps sample invoices out of storage until approved, then exports the reviewed values", async () => {
    expect(await listExpenses()).toEqual([]);

    const savedRecords = [];
    for (const sample of SAMPLE_INVOICES) {
      const reviewed = sample.id === "office-supplies"
        ? { ...sample.extraction, vendor: "Papertrail Supply House Reviewed" }
        : sample.extraction;
      savedRecords.push(await saveExpense(reviewed));
    }
    expect(await listExpenses()).toHaveLength(SAMPLE_INVOICES.length);

    const csv = expensesToCsv(savedRecords);
    for (const sample of SAMPLE_INVOICES) {
      const expectedVendor = sample.id === "office-supplies"
        ? "Papertrail Supply House Reviewed"
        : sample.extraction.vendor;
      expect(csv).toContain(expectedVendor ?? "");
      expect(csv).toContain(sample.extraction.invoiceNumber ?? "");
      expect(csv).toContain(String(sample.extraction.total));
    }

    const officeSample = SAMPLE_INVOICES.find(({ id }) => id === "office-supplies");
    if (!officeSample) throw new Error("Office-supplies sample fixture is missing.");
    const savedOfficeSample = savedRecords.find(({ invoiceNumber }) =>
      invoiceNumber === officeSample.extraction.invoiceNumber,
    );
    if (!savedOfficeSample) throw new Error("Saved office-supplies sample is missing.");
    expect(savedOfficeSample.vendor).toBe("Papertrail Supply House Reviewed");
    const edited = await saveExpense(
      { ...savedOfficeSample, vendor: "Papertrail Supply House Final" },
      savedOfficeSample,
    );
    expect(edited.vendor).toBe("Papertrail Supply House Final");

    const editedCsv = expensesToCsv([edited]);
    expect(editedCsv).toContain("Papertrail Supply House Final");
    expect(editedCsv).toContain("PSH-51028");
    expect(editedCsv).toContain(",USD,133,10.64,143.64,");
  });
});