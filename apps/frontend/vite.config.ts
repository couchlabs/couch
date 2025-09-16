import react from "@vitejs/plugin-react"
import alchemy from "alchemy/cloudflare/vite"
import tailwindcss from "@tailwindcss/vite"
import tsconfigPaths from "vite-tsconfig-paths"

import { defineConfig, type PluginOption } from "vite"

export default defineConfig({
  plugins: [alchemy() as PluginOption, react(), tailwindcss(), tsconfigPaths()],
  root: "./src",
  envDir: "../",
})
