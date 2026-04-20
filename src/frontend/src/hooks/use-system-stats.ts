// hooks/use-system-stats.ts
import { useQuery } from "@tanstack/react-query"
import { fetchStats } from "@/lib/api"
import { useWsStatus } from "@/hooks/use-websocket"

export function useSystemStats() {
  const { connected } = useWsStatus()
  return useQuery({
    queryKey: ["system-stats"],
    queryFn: fetchStats,
    // When WS is connected, stats come in via the socket — no need to poll.
    // Fall back to 500 ms polling if disconnected.
    refetchInterval: connected ? false : 500,
    refetchIntervalInBackground: !connected,
  })
}
