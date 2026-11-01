import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(root, "client"),
  plugins: [react()],
  build: {
    outDir: resolve(root, "dist", "client"),
    emptyOutDir: true
  },
  publicDir: resolve(root, "public"),
  server: {
    proxy: {
      "/api": process.env.POLUS_API_TARGET || "http://localhost:3000",
      "/privacy": process.env.POLUS_API_TARGET || "http://localhost:3000"
    }
  }
});
