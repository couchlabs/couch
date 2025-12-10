import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import alchemy from "alchemy/cloudflare/vite"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [
    alchemy(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    nodePolyfills({ include: ["buffer"] }),
  ],
  envDir: "../",
  root: './app',
  publicDir: "./public",
  server: {
    port: 8000,
    open: "chrome",
  },
})
