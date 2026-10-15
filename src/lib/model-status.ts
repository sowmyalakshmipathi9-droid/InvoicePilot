export type ModelStatus = {
  model: string;
  processingLocation: string;
  mode: "live" | "demo";
  authenticationRequired: boolean;
};

export async function loadModelStatus(): Promise<ModelStatus> {
  const response = await fetch("/api/extract");
  if (!response.ok) {
    throw new Error(`Model status request failed with status ${response.status}.`);
  }

  const status: unknown = await response.json();
  if (
    typeof status !== "object" ||
    status === null ||
    !("model" in status) ||
    typeof status.model !== "string" ||
    !("processingLocation" in status) ||
    typeof status.processingLocation !== "string" ||
    !("mode" in status) ||
    (status.mode !== "live" && status.mode !== "demo") ||
    !("authenticationRequired" in status) ||
    typeof status.authenticationRequired !== "boolean"
  ) {
    throw new Error("The model status response was invalid.");
  }

  return {
    model: status.model,
    processingLocation: status.processingLocation,
    mode: status.mode,
    authenticationRequired: status.authenticationRequired,
  };
}
