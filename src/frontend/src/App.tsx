import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Dashboard } from "./components/Dashboard"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  )
}

export default App
