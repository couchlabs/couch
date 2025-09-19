import { CdpClient } from "@coinbase/cdp-sdk"

const cdp = new CdpClient()
const CDP_WALLET_NAME = process.env.CDP_WALLET_NAME

if (!CDP_WALLET_NAME) {
  throw new Error(
    "CDP_WALLET_NAME was note defined in your .env file. Please add it and try again.",
  )
}

// Fund the CDP SMART ACCOUNT (ETH)
const cdpAccount = await cdp.evm.getAccount({
  name: CDP_WALLET_NAME,
})

const cdpSmartAccount = await cdp.evm.getSmartAccount({
  owner: cdpAccount,
  name: CDP_WALLET_NAME,
})

const cdpSmartAccountFaucetETH = await cdp.evm.requestFaucet({
  address: cdpSmartAccount.address,
  network: "base-sepolia",
  token: "eth",
})

console.log(
  `💸 ETH faucet transaction for CDP Smart Account: https://sepolia.basescan.org/tx/${cdpSmartAccountFaucetETH.transactionHash}`,
)

// Fund the TEST BASE ACCOUNT if provided (USDC)
if (process.env.TEST_BASE_ACCOUNT_ADDRESS) {
  const testBaseAccountFaucetUSDC = await cdp.evm.requestFaucet({
    address: process.env.TEST_BASE_ACCOUNT_ADDRESS,
    network: "base-sepolia",
    token: "usdc",
  })

  console.log(
    `💸 USDC faucet transaction for Test Base Account: https://sepolia.basescan.org/tx/${testBaseAccountFaucetUSDC.transactionHash}`,
  )
}
