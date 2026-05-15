import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: {
    port: 3030,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        ws: true,
        // No rewrite — API routes are registered under /api prefix natively.
      },
    },
  },
  plugins: [react()],
});
