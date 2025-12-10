import { describe, expect, test } from "bun:test"
import { getSubscriptionOwnerWalletName } from "@backend/lib/subscription-owner-wallet"

describe("getSubscriptionOwnerWalletName", () => {
  test("generates correct wallet name format", () => {
    const accountId = 123
    const walletName = getSubscriptionOwnerWalletName(accountId)

    expect(walletName).toBe("merchant-123")
  })

  test("handles single digit account IDs", () => {
    const accountId = 1
    const walletName = getSubscriptionOwnerWalletName(accountId)

    expect(walletName).toBe("merchant-1")
  })

  test("handles large account IDs", () => {
    const accountId = 999999
    const walletName = getSubscriptionOwnerWalletName(accountId)

    expect(walletName).toBe("merchant-999999")
  })

  test("is deterministic - same input produces same output", () => {
    const accountId = 456
    const walletName1 = getSubscriptionOwnerWalletName(accountId)
    const walletName2 = getSubscriptionOwnerWalletName(accountId)

    expect(walletName1).toBe(walletName2)
    expect(walletName1).toBe("merchant-456")
  })

  test("different account IDs produce different wallet names", () => {
    const walletName1 = getSubscriptionOwnerWalletName(1)
    const walletName2 = getSubscriptionOwnerWalletName(2)

    expect(walletName1).not.toBe(walletName2)
    expect(walletName1).toBe("merchant-1")
    expect(walletName2).toBe("merchant-2")
  })
})
