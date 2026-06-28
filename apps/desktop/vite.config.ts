import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@algolab/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))
    }
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/target/**",
        "**/node_modules/**",
        "**/dist/**"
      ]
    }
  },
  envPrefix: ["VITE_", "TAURI_"]
});
