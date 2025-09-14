import alchemy from "alchemy"
import { Redwood, Website } from "alchemy/cloudflare"

// import { backend } from "backend/alchemy"

const app = await alchemy("frontend")

export const frontend = await Redwood("website", {
  name: `${app.name}-${app.stage}-website`,
  adopt: true,
  bindings: {},
  dev: {
    command: "vite dev --port 5004",
  },
})

console.log({ ...frontend })

await app.finalize()
