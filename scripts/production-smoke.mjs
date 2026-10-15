import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { createProductionServer } from "../dist-server/server.mjs";

const token = "invoicepilot-test-token-with-more-than-32-bytes";
const modelExtraction = {
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

const ollama = createHttpServer((request, response) => {
  if (ollamaUnavailable) {
    response.writeHead(503).end();
    return;
  }
  request.resume();
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    model: "smoke-test-model",
    message: { content: JSON.stringify(modelExtraction) },
  }));
});
let ollamaUnavailable = false;
ollama.listen(0, "127.0.0.1");
await once(ollama, "listening");

async function startApp(options) {
  const server = createProductionServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function close(server) {
  server.close();
  await once(server, "close");
}

async function json(response) {
  return response.json();
}

const liveEnvironment = {
  NODE_ENV: "production",
  EXTRACTION_API_TOKEN: token,
  OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
  OLLAMA_MODEL: "smoke-test-model",
  CORS_ORIGINS: "https://trusted.example",
};
const live = await startApp({ environment: liveEnvironment, bodyLimitBytes: 512 });

try {
  const statusResponse = await globalThis.fetch(`${live.baseUrl}/api/extract`);
  assert.equal(statusResponse.status, 200);
  const status = await json(statusResponse);
  assert.equal(status.mode, "live");
  assert.equal(status.authenticationRequired, true);
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.equal(JSON.stringify(status).includes(liveEnvironment.OLLAMA_BASE_URL), false);

  const publicHttp = await startApp({
    environment: {
      EXTRACTION_API_TOKEN: token,
      OLLAMA_BASE_URL: "http://203.0.113.25:11434",
    },
  });
  const publicHttpStatus = await json(await globalThis.fetch(`${publicHttp.baseUrl}/api/extract`));
  assert.equal(publicHttpStatus.mode, "demo");
  await close(publicHttp.server);

  const publicHttpsWithoutGatewayAuth = await startApp({
    environment: {
      EXTRACTION_API_TOKEN: token,
      OLLAMA_BASE_URL: "https://ollama.example.com",
    },
  });
  const publicHttpsStatus = await json(await globalThis.fetch(`${publicHttpsWithoutGatewayAuth.baseUrl}/api/extract`));
  assert.equal(publicHttpsStatus.mode, "demo");
  await close(publicHttpsWithoutGatewayAuth.server);

  const publicHttpsWithGatewayAuth = await startApp({
    environment: {
      EXTRACTION_API_TOKEN: token,
      OLLAMA_BASE_URL: "https://ollama.example.com",
      OLLAMA_API_KEY: "server-side-gateway-key",
    },
  });
  const publicHttpsAuthorizedStatus = await json(await globalThis.fetch(`${publicHttpsWithGatewayAuth.baseUrl}/api/extract`));
  assert.equal(publicHttpsAuthorizedStatus.mode, "live");
  assert.equal(JSON.stringify(publicHttpsAuthorizedStatus).includes("server-side-gateway-key"), false);
  await close(publicHttpsWithGatewayAuth.server);

  const routeResponse = await globalThis.fetch(`${live.baseUrl}/expenses/2026/receipt`, {
    headers: { Accept: "text/html" },
  });
  assert.equal(routeResponse.status, 200);
  assert.match(await routeResponse.text(), /<div id="root"><\/div>/);
  const missingAsset = await globalThis.fetch(`${live.baseUrl}/assets/missing.js`);
  assert.equal(missingAsset.status, 404);

  const disallowedOrigin = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(disallowedOrigin.status, 403);
  const preflight = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://trusted.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://trusted.example");

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const unauthorized = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "A complete invoice description for testing." }),
  });
  assert.equal(unauthorized.status, 401);

  const malformed = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "POST",
    headers,
    body: "{",
  });
  assert.equal(malformed.status, 400);
  const invalidRequest = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "too short" }),
  });
  assert.equal(invalidRequest.status, 400);
  const unsupportedType = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "text/plain" },
    body: "invoice",
  });
  assert.equal(unsupportedType.status, 415);
  const oversized = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "x".repeat(600) }),
  });
  assert.equal(oversized.status, 413);

  const extracted = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "A realistic invoice text that is long enough." }),
  });
  assert.equal(extracted.status, 200);
  const liveResult = await json(extracted);
  assert.equal(liveResult.model, "smoke-test-model");
  assert.equal(liveResult.extraction.vendor, modelExtraction.vendor);

  ollamaUnavailable = true;
  const unavailable = await globalThis.fetch(`${live.baseUrl}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "Another realistic invoice text for testing." }),
  });
  assert.equal(unavailable.status, 503);
  ollamaUnavailable = false;

  const methodNotAllowed = await globalThis.fetch(`${live.baseUrl}/api/extract`, { method: "DELETE" });
  assert.equal(methodNotAllowed.status, 405);
} finally {
  await close(live.server);
}

const limited = await startApp({
  environment: liveEnvironment,
  rateLimitRequests: 1,
});
try {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const first = await globalThis.fetch(`${limited.baseUrl}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "A realistic invoice text that is long enough." }),
  });
  assert.equal(first.status, 200);
  const second = await globalThis.fetch(`${limited.baseUrl}/api/extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "A second realistic invoice text for testing." }),
  });
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("retry-after"), "60");
} finally {
  await close(limited.server);
}

const demo = await startApp({ environment: {} });
try {
  const status = await json(await globalThis.fetch(`${demo.baseUrl}/api/extract`));
  assert.equal(status.mode, "demo");
  assert.equal(status.model, "Demo fixtures only");
  const response = await globalThis.fetch(`${demo.baseUrl}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "A realistic invoice text that is long enough." }),
  });
  assert.equal(response.status, 503);
  assert.match((await json(response)).error, /demo fixture/);
} finally {
  await close(demo.server);
}

for (const environment of [
  { EXTRACTION_API_TOKEN: token },
  { OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}` },
]) {
  const partiallyConfigured = await startApp({ environment });
  try {
    const status = await json(await globalThis.fetch(`${partiallyConfigured.baseUrl}/api/extract`));
    assert.equal(status.mode, "demo");
    const response = await globalThis.fetch(`${partiallyConfigured.baseUrl}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "A realistic invoice text that is long enough." }),
    });
    assert.equal(response.status, 503);
  } finally {
    await close(partiallyConfigured.server);
  }
}

const unexpected = await startApp({
  environment: liveEnvironment,
  extract: async () => {
    throw new Error("invoice content must never appear in error responses");
  },
});
try {
  const response = await globalThis.fetch(`${unexpected.baseUrl}/api/extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "A realistic invoice text that is long enough." }),
  });
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await json(response)), /invoice content/);
} finally {
  await close(unexpected.server);
  await close(ollama);
}

globalThis.console.log("Production smoke tests passed: routes, API status, validation, auth, CORS, limits, demo, AI errors, and SPA fallback.");
