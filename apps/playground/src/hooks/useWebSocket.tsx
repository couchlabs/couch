import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

interface WebSocketMessage {
  type: "connected" | "subscription_update" | "webhook_event" | "pong"
  data?: unknown
  message?: string
}

interface WebSocketContextType {
  isConnected: boolean
  lastMessage: WebSocketMessage | null
  sendMessage: (message: string | object) => void
}

const WebSocketContext = createContext<WebSocketContextType>({
  isConnected: false,
  lastMessage: null,
  sendMessage: () => {},
})

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null)
  const pingInterval = useRef<NodeJS.Timeout | null>(null)

  const connect = useCallback(() => {
    try {
      // Connect to WebSocket endpoint
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const host = window.location.host
      ws.current = new WebSocket(`${protocol}//${host}/ws`)

      ws.current.onopen = () => {
        console.log("WebSocket connected")
        setIsConnected(true)

        // Start ping/pong heartbeat
        pingInterval.current = setInterval(() => {
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send("ping")
          }
        }, 30000) // Ping every 30 seconds
      }

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage
          console.log("WebSocket message:", message)
          setLastMessage(message)
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error)
        }
      }

      ws.current.onclose = () => {
        console.log("WebSocket disconnected")
        setIsConnected(false)

        // Clear ping interval
        if (pingInterval.current) {
          clearInterval(pingInterval.current)
        }

        // Attempt to reconnect after 2 seconds
        reconnectTimeout.current = setTimeout(() => {
          console.log("Attempting to reconnect WebSocket...")
          connect()
        }, 2000)
      }

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error)
      }
    } catch (error) {
      console.error("Failed to create WebSocket:", error)
    }
  }, [])

  useEffect(() => {
    connect()

    // Cleanup on unmount
    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current)
      }
      if (pingInterval.current) {
        clearInterval(pingInterval.current)
      }
      if (ws.current) {
        ws.current.close()
      }
    }
  }, [connect])

  const sendMessage = (message: string | object) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      const messageString =
        typeof message === "string" ? message : JSON.stringify(message)
      ws.current.send(messageString)
    }
  }

  return (
    <WebSocketContext.Provider
      value={{ isConnected, lastMessage, sendMessage }}
    >
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocket() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error("useWebSocket must be used within WebSocketProvider")
  }
  return context
}
