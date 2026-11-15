import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true, timeout: 0, proxyTimeout: 0 },
    },
  },
  preview: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true, timeout: 0, proxyTimeout: 0 },
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
