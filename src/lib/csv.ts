import type { InvoiceExtraction } from "./invoice";

export type ExpenseRecord = InvoiceExtraction & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

const columns: Array<{ label: string; get: (record: ExpenseRecord) => unknown }> = [
  { label: "Vendor", get: (record) => record.vendor },
  { label: "Invoice number", get: (record) => record.invoiceNumber },
  { label: "Invoice date", get: (record) => record.invoiceDate },
  { label: "Currency", get: (record) => record.currency },
  { label: "Subtotal", get: (record) => record.subtotal },
  { label: "Tax", get: (record) => record.tax },
  { label: "Total", get: (record) => record.total },
  { label: "Category", get: (record) => record.category },
  { label: "Description", get: (record) => record.description },
  { label: "Confidence", get: (record) => record.confidence },
  { label: "Missing fields", get: (record) => record.missingFields },
  { label: "Category reasoning", get: (record) => record.reasoning },
  { label: "Created at", get: (record) => record.createdAt },
];

function escapeCsv(value: unknown): string {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function expensesToCsv(records: ExpenseRecord[]): string {
  const header = ["ID", ...columns.map(({ label }) => label)];
  const rows = records.map((record) => [record.id, ...columns.map(({ get }) => get(record))]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}