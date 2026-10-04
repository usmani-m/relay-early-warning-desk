import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The frontend never talks to Gemini and never sees the API key: everything goes through /api on the backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // 127.0.0.1, not localhost: on Windows "localhost" may resolve to ::1 while uvicorn listens on IPv4 only.
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
