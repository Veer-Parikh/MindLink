import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.MINDLINK_API ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/collab": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
  // Monaco resolves its web workers with `new URL(..., import.meta.url)`; pre-bundling would break those paths.
  optimizeDeps: { exclude: ["monaco-editor"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
  },
});
