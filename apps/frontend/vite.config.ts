import react from "@vitejs/plugin-react"
import alchemy from "alchemy/cloudflare/vite"
import tailwindcss from "@tailwindcss/vite"
import tsconfigPaths from "vite-tsconfig-paths"
import { nodePolyfills } from "vite-plugin-node-polyfills"

import { defineConfig, type PluginOption } from "vite"

export default defineConfig({
  plugins: [
    alchemy() as PluginOption,
    react(),
    tailwindcss(),
    tsconfigPaths(),
    nodePolyfills({
      // Or you can specify only Buffer
      include: ["buffer"],
      globals: {
        Buffer: true,
      },
    }),
  ],
  root: "./src",
  envDir: "../",
  server: {
    open: "chrome",
  },
})
