import alchemy from "alchemy"
import { Vite } from "alchemy/cloudflare"

const app = await alchemy("frontend")

export const frontend = await Vite("website", {
  name: `${app.name}-${app.stage}-website`,
})

console.log({ ...frontend })

await app.finalize()
