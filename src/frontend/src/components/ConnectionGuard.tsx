import { useConnectivity } from "@/hooks/use-connectivity"
import { WifiOff, Activity, AlertCircle } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

export function ConnectionGuard() {
  const { isOffline, isApiDown } = useConnectivity()
  const active = isOffline || isApiDown

  return (
    <AnimatePresence>
      {active && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-100 flex items-center justify-center bg-background/40 backdrop-blur-sm"
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="p-8 rounded-2xl border border-primary/20 bg-card/40 shadow-[0_0_50px_rgba(var(--primary),0.1)] flex flex-col items-center gap-5 text-center max-w-xs"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
              <div className="relative h-14 w-14 rounded-full bg-secondary/50 border border-border/40 flex items-center justify-center">
                {isOffline ? (
                  <WifiOff className="text-red-500" size={24} />
                ) : (
                  <Activity className="text-primary animate-pulse" size={24} />
                )}
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="text-xs font-mono font-black uppercase tracking-[0.2em] text-foreground">
                {isOffline ? "Neural Link Severed" : "Connection Severed"}
              </h3>
              <p className="text-[10px] font-mono text-muted-foreground uppercase leading-relaxed">
                {isOffline 
                  ? "Global network interface lost. Check your connection." 
                  : "Bridge to port 11111 failed. Ensure local proxy is running."}
              </p>
            </div>

            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/10">
               <span className="text-[9px] font-mono font-bold text-primary animate-pulse">RECONNECTING...</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}