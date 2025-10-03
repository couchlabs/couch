import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import alchemy from "alchemy/cloudflare/vite"
import { defineConfig, type PluginOption } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [alchemy() as PluginOption, react(), tailwindcss(), tsconfigPaths()],
  envDir: "../",
  server: {
    port: 8000,
    open: "chrome",
  },
})
