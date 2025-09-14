import { defineConfig, type PluginOption } from "vite"
// import { redwood } from "rwsdk/vite"
// import { cloudflare } from "@cloudflare/vite-plugin"
import alchemy from "alchemy/cloudflare/redwood"

export default defineConfig({
  plugins: [alchemy() as PluginOption],
})
