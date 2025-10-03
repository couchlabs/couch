import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import alchemy from "alchemy/cloudflare/vite"
import { defineConfig, type PluginOption } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [
    alchemy() as PluginOption,
    react(),
    tailwindcss(),
    tsconfigPaths(),
    nodePolyfills({
      // Optional: Configure which polyfills to include/exclude
      // For example, to only polyfill Buffer:
      include: ["buffer"],
      // Or to exclude specific ones:
      // exclude: ['fs', 'path'],
    }),
  ],
  envDir: "../",
  server: {
    port: 8000,
    open: "chrome",
  },
})
