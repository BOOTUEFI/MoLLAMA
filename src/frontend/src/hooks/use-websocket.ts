import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { API_BASE_URL } from "@/lib/api"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WsStatus {
  connected: boolean
  reconnecting: boolean
}

// ── Context ───────────────────────────────────────────────────────────────────

export const WsStatusContext = createContext<WsStatus>({ connected: false, reconnecting: false })

export function useWsStatus(): WsStatus {
  return useContext(WsStatusContext)
}

// ── Provider hook (call once in App) ─────────────────────────────────────────

/**
 * Establishes a WebSocket connection to /ws and pushes live state into
 * the react-query cache so all existing useQuery hooks receive real-time
 * updates without being changed.
 */
export function useWebSocketProvider(): WsStatus {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<WsStatus>({ connected: false, reconnecting: false })
  const destroyed = useRef(false)

  const wsUrl = API_BASE_URL
    .replace(/^https/, "wss")
    .replace(/^http/, "ws")
    + "/ws"

  const connect = useCallback(() => {
    if (destroyed.current) return

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus({ connected: true, reconnecting: false })
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type !== "state") return

        if (msg.stats) {
          queryClient.setQueryData(["system-stats"], (old: any) => ({ ...(old ?? {}), ...msg.stats }))
        }
        if (msg.instances) {
          queryClient.setQueryData(["instances"], msg.instances)
        }
        if (msg.events) {
          queryClient.setQueryData(["events", 200], msg.events)
        }
        if (msg.streams) {
          queryClient.setQueryData(["streams"], msg.streams)
        }
        if (msg.processing) {
          queryClient.setQueryData(["processing"], msg.processing)
        }
        if (msg.models) {
          queryClient.setQueryData(["models"], msg.models)
        }
        if (msg.mcpServers) {
          queryClient.setQueryData(["mcpServers"], msg.mcpServers)
        }
        if (msg.tools) {
          queryClient.setQueryData(["tools"], msg.tools)
        }
        if (msg.appSettings) {
          queryClient.setQueryData(["appSettings"], msg.appSettings)
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onerror = () => {
      // Let onclose handle reconnect
    }

    ws.onclose = () => {
      if (destroyed.current) return
      setStatus({ connected: false, reconnecting: true })
      timerRef.current = setTimeout(connect, 2000)
    }
  }, [wsUrl, queryClient])

  useEffect(() => {
    destroyed.current = false
    connect()
    return () => {
      destroyed.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return status
}
