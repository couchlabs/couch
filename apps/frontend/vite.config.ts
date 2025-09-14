/// <reference types="vite/client" />

import react from "@vitejs/plugin-react"
import alchemy from "alchemy/cloudflare/vite"
import { defineConfig, type PluginOption } from "vite"

export default defineConfig({
  plugins: [alchemy() as PluginOption, react()],
  root: "./src",
})
