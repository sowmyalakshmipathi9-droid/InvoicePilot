import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { extractInvoiceRequest, getExtractionStatus } from "./src/lib/extract-api";
import { getOllamaConfig } from "./src/lib/ollama";

const DEFAULT_BODY_LIMIT = 128 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 10;

type ExtractionHandler = typeof extractInvoiceRequest;
type StatusHandler = typeof getExtractionStatus;

export type ProductionServerOptions = {
  environment?: NodeJS.ProcessEnv;
  distDirectory?: string;
  bodyLimitBytes?: number;
  rateLimitRequests?: number;
  rateLimitWindowMs?: number;
  now?: () => number;
  extract?: ExtractionHandler;
  status?: StatusHandler;
};

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage, maximumBytes: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += buffer.byteLength;
      if (bytesRead > maximumBytes) {
        tooLarge = true;
      } else {
        chunks.push(buffer);
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new RangeError("request body too large"));
        return;
      }
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  const origins = (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS must contain valid origins.");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin) {
      throw new Error("CORS_ORIGINS entries must be exact HTTPS origins without paths.");
    }
  }
  return new Set(origins);
}

function sameOriginRequest(request: IncomingMessage, origin: string): boolean {
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host.toLowerCase() === request.headers.host?.toLowerCase();
  } catch {
    return false;
  }
}

function getCorsOrigin(request: IncomingMessage, origins: Set<string>): string | null {
  const origin = request.headers.origin;
  if (!origin) return null;
  if (sameOriginRequest(request, origin) || origins.has(origin)) return origin;
  return null;
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) return true;

  if (isIP(host) === 4) {
    const [first, second] = host.split(".").map(Number);
    return first === 10 || first === 127 || first === 169 && second === 254 ||
      first === 172 && second >= 16 && second <= 31 ||
      first === 192 && second === 168;
  }
  if (isIP(host) === 6) {
    return host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return false;
}

function hasUsableOllamaUrl(baseUrl: string | undefined, apiKey: string | undefined): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const endpoint = new URL(baseUrl);
    if (endpoint.username || endpoint.password) return false;
    const privateNetworkHost = isPrivateNetworkHost(endpoint.hostname);
    return endpoint.protocol === "https:"
      ? privateNetworkHost || Boolean(apiKey)
      : endpoint.protocol === "http:" && privateNetworkHost;
  } catch {
    return false;
  }
}

function hasValidBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedToken);
  return received.byteLength === expected.byteLength && timingSafeEqual(received, expected);
}

function sendFile(response: ServerResponse, filePath: string, headOnly: boolean) {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  response.writeHead(200, {
    "Content-Type": contentTypes[extension] ?? "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (headOnly) {
    response.end();
    return;
  }
  createReadStream(filePath)
    .on("error", () => {
      if (!response.headersSent) sendJson(response, 500, { error: "Could not serve this page." });
      else response.destroy();
    })
    .pipe(response);
}

export function createProductionServer(options: ProductionServerOptions = {}): Server {
  const environment = options.environment ?? process.env;
  const apiToken = environment.EXTRACTION_API_TOKEN;
  if (apiToken && (apiToken.trim() !== apiToken || Buffer.byteLength(apiToken) < 32)) {
    throw new Error("EXTRACTION_API_TOKEN must be at least 32 bytes and contain no surrounding whitespace.");
  }
  const allowedOrigins = parseAllowedOrigins(environment.CORS_ORIGINS);
  const ollamaConfig = getOllamaConfig(environment);
  const liveInferenceAvailable = Boolean(
    apiToken && hasUsableOllamaUrl(environment.OLLAMA_BASE_URL, ollamaConfig.apiKey),
  );
  const distDirectory = resolve(options.distDirectory ?? "dist");
  const maximumBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT;
  const rateLimit = options.rateLimitRequests ?? RATE_LIMIT_REQUESTS;
  const rateLimitWindow = options.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS;
  const now = options.now ?? Date.now;
  const extract = options.extract ?? extractInvoiceRequest;
  const status = options.status ?? getExtractionStatus;
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  function getStatus() {
    if (!liveInferenceAvailable) {
      return {
        model: "Demo fixtures only",
        processingLocation: "Live AI is not configured; demo fixtures only",
        mode: "demo" as const,
        authenticationRequired: false,
      };
    }
    return { ...status(ollamaConfig), mode: "live" as const, authenticationRequired: true };
  }

  function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;
    const acceptedOrigin = getCorsOrigin(request, allowedOrigins);
    if (!acceptedOrigin) {
      request.resume();
      sendJson(response, 403, { error: "This origin is not allowed." });
      return false;
    }
    if (!sameOriginRequest(request, acceptedOrigin)) {
      response.setHeader("Access-Control-Allow-Origin", acceptedOrigin);
      response.setHeader("Vary", "Origin");
    }
    return true;
  }

  function isRateLimited(request: IncomingMessage): boolean {
    const key = request.socket.remoteAddress ?? "unknown";
    const current = now();
    for (const [address, bucket] of requestCounts) {
      if (bucket.resetAt <= current) requestCounts.delete(address);
    }
    const bucket = requestCounts.get(key);
    if (!bucket || bucket.resetAt <= current) {
      requestCounts.set(key, { count: 1, resetAt: current + rateLimitWindow });
      return false;
    }
    bucket.count += 1;
    return bucket.count > rateLimit;
  }

  async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string) {
    if (pathname !== "/api/extract") {
      request.resume();
      sendJson(response, 404, { error: "API route not found." });
      return;
    }
    if (!applyCors(request, response)) return;

    if (request.method === "OPTIONS") {
      const corsOrigin = request.headers.origin ? getCorsOrigin(request, allowedOrigins) : null;
      if (request.headers.origin && !corsOrigin) {
        sendJson(response, 403, { error: "This origin is not allowed." });
        return;
      }
      const requestedHeaders = (request.headers["access-control-request-headers"] ?? "")
        .split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
      if (requestedHeaders.some((header) => header !== "authorization" && header !== "content-type")) {
        sendJson(response, 403, { error: "This request header is not allowed." });
        return;
      }
      response.writeHead(204, {
        "Allow": "GET, POST, OPTIONS",
        ...(corsOrigin && !sameOriginRequest(request, corsOrigin)
          ? {
              "Access-Control-Allow-Origin": corsOrigin,
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Authorization, Content-Type",
              "Access-Control-Max-Age": "600",
              "Vary": "Origin",
            }
          : {}),
      });
      response.end();
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, getStatus());
      return;
    }
    if (request.method !== "POST") {
      request.resume();
      sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, POST, OPTIONS" });
      return;
    }
    if (isRateLimited(request)) {
      request.resume();
      sendJson(response, 429, { error: "Too many extraction requests. Wait a minute and try again." }, {
        "Retry-After": String(Math.max(1, Math.ceil(rateLimitWindow / 1000))),
      });
      return;
    }
    if (!liveInferenceAvailable || !apiToken) {
      request.resume();
      sendJson(response, 503, {
        error: "Live AI extraction is not configured. Use the explicitly labeled demo fixture or ask the operator to configure secure inference.",
      });
      return;
    }
    if (!hasValidBearerToken(request, apiToken)) {
      request.resume();
      sendJson(response, 401, { error: "A valid server access token is required for live extraction." });
      return;
    }
    const contentType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      request.resume();
      sendJson(response, 415, { error: "Content-Type must be application/json." });
      return;
    }
    const contentLength = Number(request.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
      sendJson(response, 413, { error: "Request body is too large." });
      request.resume();
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(request, maximumBytes));
    } catch (error) {
      if (error instanceof RangeError) {
        sendJson(response, 413, { error: "Request body is too large." });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Request body must be valid JSON." });
        return;
      }
      sendJson(response, 400, { error: "Could not read the request body." });
      return;
    }

    try {
      const result = await extract(body, ollamaConfig);
      sendJson(response, result.status, result.body);
    } catch {
      sendJson(response, 500, { error: "Extraction failed unexpectedly. Try again later." });
    }
  }

  return createServer((request, response) => {
    void (async () => {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      } catch {
        request.resume();
        sendJson(response, 400, { error: "Invalid request path." });
        return;
      }

      if (pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        request.resume();
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
        return;
      }

      const candidate = resolve(distDirectory, `.${pathname}`);
      const relativePath = relative(distDirectory, candidate);
      if (isAbsolute(relativePath) || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
        sendJson(response, 404, { error: "Page not found." });
        return;
      }
      let filePath: string;
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        filePath = candidate;
      } else if (request.headers.accept?.includes("text/html")) {
        filePath = resolve(distDirectory, "index.html");
      } else {
        sendJson(response, 404, { error: "File not found." });
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        sendJson(response, 500, { error: "The production frontend is missing. Run the build command." });
        return;
      }
      sendFile(response, filePath, request.method === "HEAD");
    })().catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "The request could not be completed." });
      else response.destroy();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const configuredPort = process.env.PORT?.trim();
  const port = configuredPort ? Number(configuredPort) : 3000;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  const server = createProductionServer();
  server.listen(port, "0.0.0.0", () => {
    console.info(`InvoicePilot production server listening on 0.0.0.0:${port}`);
  });
}
