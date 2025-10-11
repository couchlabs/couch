export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export interface LogContext {
  subscriptionId?: string
  orderId?: number
  transactionHash?: string
  userId?: string
  [key: string]: string | number | boolean | null | undefined
}

class Logger {
  private context: LogContext = {}

  with(context: LogContext): Logger {
    const logger = new Logger()
    logger.context = { ...this.context, ...context }
    return logger
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    // Silence all logs in test environment
    if (process.env.NODE_ENV === "test") {
      return
    }

    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      level,
      message,
      ...this.context,
      ...(data && { data }),
    }

    // In production, this could send to a logging service
    // For CF Workers, console.log is captured in logs
    switch (level) {
      case LogLevel.ERROR:
        console.error(JSON.stringify(logEntry))
        break
      case LogLevel.WARN:
        console.warn(JSON.stringify(logEntry))
        break
      default:
        console.log(JSON.stringify(logEntry))
    }
  }

  debug(message: string, data?: unknown) {
    this.log(LogLevel.DEBUG, message, data)
  }

  info(message: string, data?: unknown) {
    this.log(LogLevel.INFO, message, data)
  }

  warn(message: string, data?: unknown) {
    this.log(LogLevel.WARN, message, data)
  }

  error(message: string, error?: unknown) {
    const err = error as Error | undefined
    this.log(LogLevel.ERROR, message, {
      error: err?.message || String(error),
      stack: err?.stack,
    })
  }

  // Convenience method for operation tracking
  operation(operation: string) {
    return {
      start: (details?: unknown) => {
        this.info(`${operation} started`, details)
      },
      success: (details?: unknown) => {
        this.info(`${operation} completed`, details)
      },
      failure: (error: unknown) => {
        this.error(`${operation} failed`, error)
      },
    }
  }
}

export const logger = new Logger()

/**
 * Creates a logger with module tracking
 * @param module - Module name (e.g., 'subscription.service', 'onchain.repository', 'webhook.consumer')
 */
export function createLogger(module: string): Logger {
  return logger.with({ module })
}

/**
 * Drizzle ORM logger implementation
 * Integrates Drizzle query logging with our existing logger infrastructure
 */
export class DrizzleLogger implements DrizzleLoggerInterface {
  private logger: Logger

  constructor(module = "drizzle") {
    this.logger = createLogger(module)
  }

  logQuery(query: string, params: unknown[]): void {
    this.logger.debug("SQL Query", {
      sql: query,
      params: params.length > 0 ? params : undefined,
    })
  }
}

// Drizzle Logger interface (from drizzle-orm/logger)
interface DrizzleLoggerInterface {
  logQuery(query: string, params: unknown[]): void
}

// Auto logger factory that automatically detects type from file path
// Usage: const logger = createAutoLogger(import.meta.url)
export function createAutoLogger(url: string): Logger {
  // Extract parts of the path
  const parts = url.split("/")
  const filename = parts.pop() || "unknown"

  // Get relative path from 'src/' onwards (last 2-3 meaningful folders + filename)
  const srcIndex = parts.indexOf("src")
  const relativePath =
    srcIndex >= 0
      ? `${parts.slice(srcIndex + 1).join("/")}/${filename}`
      : filename

  // Auto-detect type from path structure
  // Check more specific paths first to handle nested structures
  let type = "component"
  if (url.includes("/middleware/")) type = "middleware"
  else if (url.includes("/services/")) type = "service"
  else if (url.includes("/repositories/")) type = "repository"
  else if (url.includes("/providers/")) type = "provider"
  else if (url.includes("/consumers/")) type = "consumer"
  else if (url.includes("/schedulers/")) type = "scheduler"
  else if (url.includes("/routes/")) type = "route"
  else if (url.includes("/api/")) type = "api"

  return logger.with({
    file: filename, // Just filename for quick reference
    path: relativePath, // Relative path for full context
    type, // Auto-detected component type
  })
}
