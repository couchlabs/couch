import alchemy from "alchemy"
import { Vite } from "alchemy/cloudflare"
import { spenderSmartAccount } from "backend/alchemy"

const app = await alchemy("frontend")

export const frontend = await Vite("website", {
  name: `${app.name}-${app.stage}-website`,
  dev: {
    command: "bun vite dev", // this should be optional https://github.com/sam-goodwin/alchemy/pull/1014
    env: {
      VITE_COUCH_WALLET_ADDRESS: spenderSmartAccount.address,
    },
  },
  build: {
    command: "bun vite dev", // this should be optional https://github.com/sam-goodwin/alchemy/pull/1014
    env: {
      VITE_COUCH_WALLET_ADDRESS: spenderSmartAccount.address,
    },
  },
})

console.log({ ...frontend })

await app.finalize()
