import { WorkerEntrypoint } from "cloudflare:workers"
import type { Address } from "viem"
import { AccountService } from "@/services/account.service"

export class RPC extends WorkerEntrypoint {
  /**
   * Gets or creates an account for the given EVM address
   * Skips allowlist check - trusted internal caller (merchant app)
   * Returns only success status - no sensitive data exposed
   */
  async getOrCreateAccount(address: Address): Promise<{ success: boolean }> {
    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    // Skip allowlist check - trusted internal caller
    return accountService.getOrCreateAccount({ address })
  }
}

export default RPC
