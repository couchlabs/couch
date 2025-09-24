/**
 * Onchain repository specific errors
 */

export class OnchainError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = "OnchainError"
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

export class ChargeFailedError extends OnchainError {
  constructor(
    public reason: string,
    public amount: string,
    public subscriptionId: string,
    cause?: unknown,
  ) {
    super(`Charge failed: ${reason}`, "CHARGE_FAILED", {
      amount,
      subscriptionId,
      cause,
    })
  }
}

export class RevocationError extends OnchainError {
  constructor(
    message: string,
    public subscriptionId: string,
    public userOpHash?: string,
    cause?: unknown,
  ) {
    super(message, "REVOCATION_FAILED", {
      subscriptionId,
      userOpHash,
      cause,
    })
  }
}

export class WalletNotFoundError extends OnchainError {
  constructor(
    public walletName: string,
    public walletType: "EOA" | "Smart",
  ) {
    super(
      `${walletType} wallet "${walletName}" not found`,
      "WALLET_NOT_FOUND",
      { walletName, walletType },
    )
  }
}

export class UserOperationFailedError extends OnchainError {
  constructor(
    public userOpHash: string,
    public operation: "charge" | "revoke",
    cause?: unknown,
  ) {
    super(
      `User operation failed for ${operation}: ${userOpHash}`,
      "USER_OPERATION_FAILED",
      { userOpHash, operation, cause },
    )
  }
}

/**
 * Factory functions for common onchain errors
 */
export const OnchainErrors = {
  chargeFailed: (
    reason: string,
    amount: string,
    subscriptionId: string,
    cause?: unknown,
  ) => new ChargeFailedError(reason, amount, subscriptionId, cause),

  revocationFailed: (
    message: string,
    subscriptionId: string,
    userOpHash?: string,
    cause?: unknown,
  ) => new RevocationError(message, subscriptionId, userOpHash, cause),

  eoaWalletNotFound: (walletName: string) =>
    new WalletNotFoundError(walletName, "EOA"),

  smartWalletNotFound: (walletName: string) =>
    new WalletNotFoundError(walletName, "Smart"),

  userOperationFailed: (
    userOpHash: string,
    operation: "charge" | "revoke",
    cause?: unknown,
  ) => new UserOperationFailedError(userOpHash, operation, cause),

  subscriptionOwnerMismatch: (
    subscriptionId: string,
    expected: string,
    actual?: string,
  ) =>
    new OnchainError(
      `Subscription ${subscriptionId} owner mismatch. Expected: ${expected}, Actual: ${actual || "unknown"}`,
      "SUBSCRIPTION_OWNER_MISMATCH",
      { subscriptionId, expected, actual },
    ),
}
