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
