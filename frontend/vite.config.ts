import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // локальная разработка: backend поднимается как
    //   php -S 127.0.0.1:8091 backend/api/index.php
    proxy: {
      "/api": "http://127.0.0.1:8091",
    },
  },
});
