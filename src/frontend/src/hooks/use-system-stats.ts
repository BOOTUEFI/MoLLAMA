// hooks/use-system-stats.ts
import { useQuery } from "@tanstack/react-query"
import { fetchStats } from "@/lib/api"

export function useSystemStats() {
  return useQuery({
    queryKey: ["system-stats"],
    queryFn: fetchStats,
    refetchInterval: 500,
    // Keep data fresh even when the window is out of focus if needed
    refetchIntervalInBackground: true, 
  })
}