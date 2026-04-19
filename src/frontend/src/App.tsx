import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Dashboard } from "./components/Dashboard"
import { WsStatusContext, useWebSocketProvider } from "./hooks/use-websocket"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function AppInner() {
  const wsStatus = useWebSocketProvider()
  return (
    <WsStatusContext.Provider value={wsStatus}>
      <Dashboard />
    </WsStatusContext.Provider>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  )
}

export default App
