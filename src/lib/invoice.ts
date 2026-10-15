import { z } from "zod";

export const EXPENSE_CATEGORIES = [
  "Software",
  "Travel",
  "Meals",
  "Office supplies",
  "Professional services",
  "Marketing",
  "Utilities",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type Confidence = "low" | "medium" | "high";
export type MissingField =
  | "vendor"
  | "invoiceNumber"
  | "invoiceDate"
  | "currency"
  | "subtotal"
  | "tax"
  | "total"
  | "category"
  | "description";

const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const modelOutputSchema = z
  .object({
    vendor: nullableText(160),
    invoiceNumber: nullableText(100),
    invoiceDate: z
      .string()
      .trim()
      .nullable()
      .optional()
      .refine((value) => value == null || validDate(value), "Invalid calendar date"),
    currency: z
      .string()
      .trim()
      .nullable()
      .optional()
      .refine((value) => value == null || /^[A-Za-z]{3}$/.test(value), "Expected a 3-letter currency code"),
    subtotal: z.number().finite().nonnegative().nullable().optional(),
    tax: z.number().finite().nonnegative().nullable().optional(),
    total: z.number().finite().nonnegative().nullable().optional(),
    category: z.enum(EXPENSE_CATEGORIES).nullable().optional(),
    description: nullableText(240),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    missingFields: z.array(z.string()).optional(),
    reasoning: nullableText(400),
  })
  .strict();

export const invoiceExtractionSchema = z.object({
  vendor: z.string().max(160).nullable(),
  invoiceNumber: z.string().max(100).nullable(),
  invoiceDate: z.string().refine((value) => value === "" || validDate(value), "Invalid calendar date"),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  subtotal: z.number().finite().nonnegative().nullable(),
  tax: z.number().finite().nonnegative().nullable(),
  total: z.number().finite().nonnegative().nullable(),
  category: z.enum(EXPENSE_CATEGORIES).nullable(),
  description: z.string().max(240),
  confidence: z.enum(["low", "medium", "high"]),
  missingFields: z.array(z.enum([
    "vendor",
    "invoiceNumber",
    "invoiceDate",
    "currency",
    "subtotal",
    "tax",
    "total",
    "category",
    "description",
  ])),
  reasoning: z.string().max(400),
});

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;

const trackedFields: MissingField[] = [
  "vendor",
  "invoiceNumber",
  "invoiceDate",
  "currency",
  "subtotal",
  "tax",
  "total",
  "category",
  "description",
];

export function parseModelExtraction(value: unknown): InvoiceExtraction {
  const parsed = modelOutputSchema.parse(value);
  const extraction: InvoiceExtraction = {
    vendor: parsed.vendor?.trim() || null,
    invoiceNumber: parsed.invoiceNumber?.trim() || null,
    invoiceDate: parsed.invoiceDate ?? "",
    currency: parsed.currency?.toUpperCase() ?? null,
    subtotal: parsed.subtotal ?? null,
    tax: parsed.tax ?? null,
    total: parsed.total ?? null,
    category: parsed.category ?? null,
    description: parsed.description?.trim() ?? "",
    confidence: parsed.confidence ?? "low",
    missingFields: [],
    reasoning: parsed.reasoning?.trim() ?? "",
  };
  const modelMissing = new Set(
    (parsed.missingFields ?? []).filter((field): field is MissingField =>
      trackedFields.includes(field as MissingField),
    ),
  );
  extraction.missingFields = trackedFields.filter((field) => {
    const value = extraction[field];
    return modelMissing.has(field) || value === null || value === "";
  });
  return invoiceExtractionSchema.parse(extraction);
}

export function getFinancialWarnings(invoice: InvoiceExtraction): string[] {
  if (invoice.subtotal === null || invoice.tax === null || invoice.total === null) return [];
  const difference = Math.abs(invoice.subtotal + invoice.tax - invoice.total);
  return difference > 0.02
    ? ["Subtotal plus tax differs from the total. Check discounts, shipping, or other adjustments."]
    : [];
}

export function createEmptyExtraction(): InvoiceExtraction {
  return {
    vendor: null,
    invoiceNumber: null,
    invoiceDate: "",
    currency: null,
    subtotal: null,
    tax: null,
    total: null,
    category: null,
    description: "",
    confidence: "low",
    missingFields: [...trackedFields],
    reasoning: "",
  };
}