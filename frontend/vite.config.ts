import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev mode: vite dev server on 5173, proxy /api + /outputs -> backend on 8790.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8790",
      "/outputs": "http://localhost:8790",
    },
  },
});
