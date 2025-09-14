import alchemy from "alchemy"
import { Vite } from "alchemy/cloudflare"
import { backend } from "../backend/alchemy.run"

const app = await alchemy("frontend")

export const frontend = await Vite("website", {
  name: `${app.name}-${app.stage}-website`,
  bindings: {
    API_URL: backend.url!,
  },
})

console.log({ ...frontend })

await app.finalize()
