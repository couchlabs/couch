import { CdpClient } from "@coinbase/cdp-sdk"
import { readFileSync, writeFileSync } from "fs"

const cdp = new CdpClient()
const CDP_WALLET_NAME = process.env.CDP_WALLET_NAME

if (!CDP_WALLET_NAME) {
  throw new Error(
    "CDP_WALLET_NAME was note defined in your .env file. Please add it and try again.",
  )
}
const cdp_account = await cdp.evm.getOrCreateAccount({
  name: CDP_WALLET_NAME,
})

console.log(
  `👛 CDP EVM EOA. Address: ${cdp_account.address}, Name: ${cdp_account.name}`,
)

const cdp_smart_account = await cdp.evm.getOrCreateSmartAccount({
  owner: cdp_account,
  name: CDP_WALLET_NAME,
})

console.log(
  `👛 CDP EVM Smart Account. Address: ${cdp_smart_account.address}, Name: ${cdp_smart_account.name}`,
)

// Read .env file and update both smart account addresses
const envContent = readFileSync(".env", "utf-8")

let updatedContent = updateOrInsertEnv(
  envContent,
  "VITE_COUCH_WALLET_ADDRESS",
  cdp_smart_account.address,
)
updatedContent = updateOrInsertEnv(
  updatedContent,
  "CDP_SMART_ACCOUNT_ADDRESS",
  cdp_smart_account.address,
  "CDP_WALLET_NAME",
)

writeFileSync(".env", updatedContent)
console.log(
  `✏️ Updated VITE_COUCH_WALLET_ADDRESS and CDP_SMART_ACCOUNT_ADDRESS in the .env file`,
)

// Helper to update or insert env variable
function updateOrInsertEnv(
  content: string,
  key: string,
  value: string,
  afterKey?: string,
): string {
  const regex = new RegExp(`^${key}=.*$`, "m")
  if (content.match(regex)) {
    return content.replace(regex, `${key}=${value}`)
  }
  // Insert after specified key or at the end
  if (afterKey) {
    return content.replace(
      new RegExp(`^(${afterKey}=.*)$`, "m"),
      `$1\n${key}=${value}`,
    )
  }
  return content + `\n${key}=${value}`
}
