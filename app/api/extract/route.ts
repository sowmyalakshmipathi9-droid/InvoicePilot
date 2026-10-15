import { extractInvoiceRequest, getExtractionStatus } from "../../../../src/lib/extract-api";

export const runtime = "nodejs";

export function GET() {
  return Response.json(getExtractionStatus());
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = await extractInvoiceRequest(body);
  return Response.json(result.body, { status: result.status });
}