import { z } from "zod";
import { extractWithOllama, getOllamaConfig, isLocalOllama, OllamaError } from "./ollama";
import type { OllamaConfig } from "./ollama";

const requestSchema = z.object({ text: z.string().trim().min(20).max(30_000) });

export function getExtractionStatus(config: OllamaConfig = getOllamaConfig()) {
  return {
    model: config.model,
    processingLocation: isLocalOllama(config) ? "local" : "configured remote Ollama host",
  };
}

export async function extractInvoiceRequest(
  body: unknown,
  config: OllamaConfig = getOllamaConfig(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Paste at least 20 characters of invoice text (up to 30,000)." },
    };
  }

  try {
    return { status: 200, body: await extractWithOllama(parsed.data.text, config) };
  } catch (error) {
    const message = error instanceof OllamaError
      ? error.message
      : "Extraction failed unexpectedly. Check the Ollama service and try again.";
    return { status: 503, body: { error: message } };
  }
}
