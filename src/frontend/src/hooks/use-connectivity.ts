import { useState, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { API_BASE_URL } from "@/lib/api"

export function useConnectivity() {
  const queryClient = useQueryClient()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [isApiDown, setIsApiDown] = useState(false)

  useEffect(() => {
    // 1. Monitor Browser Network Status
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // 2. Poll the MoLLAMA health endpoint specifically
    const checkApi = async () => {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000) // 3s timeout

        const res = await fetch(`${API_BASE_URL}/health`, { 
          signal: controller.signal,
          mode: 'no-cors' // Use no-cors just to check if the port is reachable
        })
        
        setIsApiDown(false)
        clearTimeout(timeoutId)
      } catch (err) {
        // If fetch fails entirely, the port is closed or unreachable
        setIsApiDown(true)
      }
    }

    const interval = setInterval(checkApi, 1500) // Check every 1.5 seconds
    checkApi()

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      clearInterval(interval)
    }
  }, [API_BASE_URL])

  return { isOffline, isApiDown }
}