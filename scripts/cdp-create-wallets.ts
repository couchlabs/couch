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
  `👛 Created CDP EVM EOA. Address: ${cdp_account.address}, Name: ${cdp_account.name}`,
)

const cdp_smart_account = await cdp.evm.getOrCreateSmartAccount({
  owner: cdp_account,
  name: CDP_WALLET_NAME,
})

console.log(
  `👛 Created CDP EVM Smart Account. Address: ${cdp_smart_account.address}, Name: ${cdp_smart_account.name}`,
)

// Read .env file and update VITE_COUCH_WALLET_ADDRESS
const envContent = readFileSync('.env', 'utf-8')
const updatedContent = envContent.replace(
  /^VITE_COUCH_WALLET_ADDRESS=.*$/m,
  `VITE_COUCH_WALLET_ADDRESS=${cdp_smart_account.address}`
)
writeFileSync('.env', updatedContent)
console.log(`✏️ Updated VITE_COUCH_WALLET_ADDRESS in the .env file`)
