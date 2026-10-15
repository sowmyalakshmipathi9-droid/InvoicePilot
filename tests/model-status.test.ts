import { afterEach, describe, expect, it, vi } from "vitest";
import { loadModelStatus } from "../src/lib/model-status";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("model status", () => {
  it("loads and validates the configured status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          model: "gemma3:4b",
          processingLocation: "local",
          mode: "live",
          authenticationRequired: false,
        })),
      ),
    );

    await expect(loadModelStatus()).resolves.toEqual({
      model: "gemma3:4b",
      processingLocation: "local",
      mode: "live",
      authenticationRequired: false,
    });
  });

  it("rejects unsuccessful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(loadModelStatus()).rejects.toThrow("Model status request failed with status 404.");
  });

  it("rejects an invalid status payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "gemma3:4b" }))));

    await expect(loadModelStatus()).rejects.toThrow("The model status response was invalid.");
  });
});
