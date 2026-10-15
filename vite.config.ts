import { defineConfig, loadEnv } from "vite";
import type { Connect, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { getOllamaConfig } from "./src/lib/ollama";
import { extractInvoiceRequest, getExtractionStatus } from "./src/lib/extract-api";
import type { OllamaConfig } from "./src/lib/ollama";

function sendJson(response: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function readRequestBody(request: Parameters<Connect.NextHandleFunction>[0]): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function extractionApi(config: () => OllamaConfig): Connect.NextHandleFunction {
  return (request, response, next) => {
    void (async () => {
      if (request.method === "GET") {
        sendJson(response, 200, getExtractionStatus(config()));
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "GET, POST");
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(await readRequestBody(request));
      } catch (error) {
        if (error instanceof SyntaxError) {
          sendJson(response, 400, { error: "Request body must be valid JSON." });
          return;
        }
        throw error;
      }

      const result = await extractInvoiceRequest(body, config());
      sendJson(response, result.status, result.body);
    })().catch(next);
  };
}

function extractionApiPlugin(): Plugin {
  let config = getOllamaConfig();
  const middleware = extractionApi(() => config);
  return {
    name: "invoicepilot-extraction-api",
    config(_viteConfig, { mode }) {
      config = getOllamaConfig({ ...loadEnv(mode, process.cwd(), "OLLAMA_"), ...process.env });
    },
    configureServer(server) {
      server.middlewares.use("/api/extract", middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/extract", middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), extractionApiPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
