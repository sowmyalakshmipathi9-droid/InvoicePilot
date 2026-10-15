import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL("./server.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "server.mjs",
    },
    outDir: "dist-server",
    emptyOutDir: true,
    rollupOptions: {
      external: [/^node:/],
    },
  },
});
