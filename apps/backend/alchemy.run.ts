import path from "node:path"

import alchemy from "alchemy"
import { Worker } from "alchemy/cloudflare"

const app = await alchemy("backend")

export const backend = await Worker("worker", {
  name: `${app.name}-${app.stage}-backend`,
  entrypoint: path.join(import.meta.dirname, "src", "index.ts"),
  bindings: {
    API_KEY: alchemy.secret.env.API_KEY,
  },
})

console.log({ ...backend })

await app.finalize()
