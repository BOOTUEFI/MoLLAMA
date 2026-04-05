import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true, // Listen on all local IP addresses (0.0.0.0)
    strictPort: true, // Optional: ensures it stays on the port you expect
    allowedHosts: true, // Allow requests from any host (use with caution in production)
  },
})
