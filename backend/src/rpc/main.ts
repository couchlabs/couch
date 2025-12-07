import { WorkerEntrypoint } from "cloudflare:workers"
import type { Address } from "viem"
import type { LoggingLevel } from "@/constants/env.constants"
import { AccountService } from "@/services/account.service"

interface BackendRPCEnv {
  DB: D1Database
  LOGGING: LoggingLevel
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
}

export class RPC extends WorkerEntrypoint<BackendRPCEnv> {
  /**
   * Gets or creates an account for the given EVM address
   * Skips allowlist check - trusted internal caller (merchant app)
   * Returns only success status - no sensitive data exposed
   */
  async getOrCreateAccount(params: {
    address: Address
  }): Promise<{ success: boolean }> {
    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    // Skip allowlist check - trusted internal caller
    return accountService.getOrCreateAccount({ address: params.address })
  }
}

export default RPC
