import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { ErrorCode, HTTPError } from "@backend/errors/http.errors"
import { createLogger, LogLevel } from "./logger"

describe("Logger", () => {
  let originalConsoleLog: typeof console.log
  let originalConsoleError: typeof console.error
  let originalConsoleWarn: typeof console.warn
  let originalNodeEnv: string | undefined
  let consoleLogSpy: ReturnType<typeof mock>
  let consoleErrorSpy: ReturnType<typeof mock>
  let consoleWarnSpy: ReturnType<typeof mock>

  beforeEach(() => {
    // Save original console methods and NODE_ENV
    originalConsoleLog = console.log
    originalConsoleError = console.error
    originalConsoleWarn = console.warn
    originalNodeEnv = process.env.NODE_ENV

    // Set NODE_ENV to production so logs aren't silenced
    process.env.NODE_ENV = "production"

    // Mock console methods
    consoleLogSpy = mock(() => {})
    consoleErrorSpy = mock(() => {})
    consoleWarnSpy = mock(() => {})
    console.log = consoleLogSpy
    console.error = consoleErrorSpy
    console.warn = consoleWarnSpy
  })

  afterEach(() => {
    // Restore original console methods and NODE_ENV
    console.log = originalConsoleLog
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
    process.env.NODE_ENV = originalNodeEnv
  })

  describe("error() method", () => {
    it("logs regular Error with message and stack", () => {
      const logger = createLogger("test.module")
      const error = new Error("Test error message")

      logger.error("Operation failed", error)

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      expect(loggedData.level).toBe(LogLevel.ERROR)
      expect(loggedData.message).toBe("Operation failed")
      expect(loggedData.module).toBe("test.module")
      expect(loggedData.data.error).toBe("Test error message")
      expect(loggedData.data.stack).toBeDefined()
      expect(loggedData.data.stack).toContain("Test error message")
    })

    it("extracts HTTPError code and details including originalError", () => {
      const logger = createLogger("test.module")
      const httpError = new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance in wallet",
        {
          originalError: "ERC20: transfer amount exceeds balance",
          subscriptionId: "0x1234",
        },
      )

      logger.error("Payment failed", httpError)

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      expect(loggedData.level).toBe(LogLevel.ERROR)
      expect(loggedData.message).toBe("Payment failed")
      expect(loggedData.data.error).toBe("Insufficient balance in wallet")
      expect(loggedData.data.errorCode).toBe(ErrorCode.INSUFFICIENT_BALANCE)
      expect(loggedData.data.details).toEqual({
        originalError: "ERC20: transfer amount exceeds balance",
        subscriptionId: "0x1234",
      })
      expect(loggedData.data.stack).toBeDefined()
    })

    it("extracts HTTPError with only originalError in details", () => {
      const logger = createLogger("onchain.repository")
      const httpError = new HTTPError(
        500,
        ErrorCode.PAYMENT_FAILED,
        "Payment failed",
        {
          originalError: "CDP API error: rate limit exceeded",
        },
      )

      logger.error("Onchain charge failed", httpError)

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      expect(loggedData.data.errorCode).toBe(ErrorCode.PAYMENT_FAILED)
      expect(loggedData.data.details).toEqual({
        originalError: "CDP API error: rate limit exceeded",
      })
    })

    it("handles HTTPError without details property", () => {
      const logger = createLogger("test.module")
      const httpError = new HTTPError(
        500,
        ErrorCode.INTERNAL_ERROR,
        "Internal error",
      )

      logger.error("System failure", httpError)

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      expect(loggedData.data.errorCode).toBe(ErrorCode.INTERNAL_ERROR)
      expect(loggedData.data.details).toBeUndefined()
    })

    it("handles non-Error objects gracefully", () => {
      const logger = createLogger("test.module")

      logger.error("Unknown error", "string error")

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      expect(loggedData.data.error).toBe("string error")
      expect(loggedData.data.stack).toBeUndefined()
      expect(loggedData.data.errorCode).toBeUndefined()
    })

    it("handles null/undefined error gracefully", () => {
      const logger = createLogger("test.module")

      logger.error("No error provided")

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      expect(loggedData.data.error).toBe("undefined")
      expect(loggedData.data.stack).toBeUndefined()
    })

    it("preserves logger context with HTTPError", () => {
      const logger = createLogger("order.service").with({
        orderId: 123,
        subscriptionId: "0xabc",
      })

      const httpError = new HTTPError(
        402,
        ErrorCode.PERMISSION_EXPIRED,
        "Permission has expired",
        {
          originalError: "Subscription expired at block 12345",
        },
      )

      logger.error("Charge failed", httpError)

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      // Context should be preserved
      expect(loggedData.module).toBe("order.service")
      expect(loggedData.orderId).toBe(123)
      expect(loggedData.subscriptionId).toBe("0xabc")

      // HTTPError details should be extracted
      expect(loggedData.data.errorCode).toBe(ErrorCode.PERMISSION_EXPIRED)
      expect(loggedData.data.details.originalError).toBe(
        "Subscription expired at block 12345",
      )
    })
  })

  describe("info/warn/debug methods", () => {
    it("logs info messages correctly", () => {
      const logger = createLogger("test.module")

      logger.info("Test info message", { key: "value" })

      expect(consoleLogSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0])

      expect(loggedData.level).toBe(LogLevel.INFO)
      expect(loggedData.message).toBe("Test info message")
      expect(loggedData.data).toEqual({ key: "value" })
    })

    it("logs warn messages correctly", () => {
      const logger = createLogger("test.module")

      logger.warn("Test warning", { count: 5 })

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleWarnSpy.mock.calls[0][0])

      expect(loggedData.level).toBe(LogLevel.WARN)
      expect(loggedData.message).toBe("Test warning")
      expect(loggedData.data).toEqual({ count: 5 })
    })
  })

  describe("with() context chaining", () => {
    it("chains context correctly", () => {
      const baseLogger = createLogger("test.module")
      const contextLogger = baseLogger.with({ userId: "user123" })
      const nestedLogger = contextLogger.with({ orderId: 456 })

      nestedLogger.info("Test message")

      expect(consoleLogSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleLogSpy.mock.calls[0][0])

      expect(loggedData.module).toBe("test.module")
      expect(loggedData.userId).toBe("user123")
      expect(loggedData.orderId).toBe(456)
    })
  })

  describe("operation() helper", () => {
    it("logs operation lifecycle", () => {
      const logger = createLogger("test.module")
      const op = logger.operation("testOperation")

      op.start({ step: 1 })
      op.success({ result: "done" })

      expect(consoleLogSpy).toHaveBeenCalledTimes(2)

      const startLog = JSON.parse(consoleLogSpy.mock.calls[0][0])
      expect(startLog.message).toBe("testOperation started")
      expect(startLog.data).toEqual({ step: 1 })

      const successLog = JSON.parse(consoleLogSpy.mock.calls[1][0])
      expect(successLog.message).toBe("testOperation completed")
      expect(successLog.data).toEqual({ result: "done" })
    })

    it("logs operation failure with HTTPError details", () => {
      const logger = createLogger("test.module")
      const op = logger.operation("processPayment")

      const httpError = new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Not enough funds",
        {
          originalError: "Balance: 0.5 USDC, Required: 1.0 USDC",
        },
      )

      op.failure(httpError)

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const loggedData = JSON.parse(consoleErrorSpy.mock.calls[0][0])

      expect(loggedData.message).toBe("processPayment failed")
      expect(loggedData.data.errorCode).toBe(ErrorCode.INSUFFICIENT_BALANCE)
      expect(loggedData.data.details.originalError).toBe(
        "Balance: 0.5 USDC, Required: 1.0 USDC",
      )
    })
  })
})
