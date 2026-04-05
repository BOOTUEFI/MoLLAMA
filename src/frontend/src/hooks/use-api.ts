import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  fetchInstances,
  fetchEvents,
  fetchProcessing,
  fetchModels,
  fetchInstanceModels,
  fetchSystemPrompt,
  deployInstance,
  banInstance,
  unbanInstance,
  startInstance,
  stopInstance,
  removeInstance,
  updateInstance,
  setMainNode,
  unsetMainNode,
  saveSystemPrompt,
  deleteModel,
} from "@/lib/api"

export const useInstances = (options?: { refetchInterval?: number | false }) => {
  return useQuery({
    queryKey: ["instances"],
    queryFn: fetchInstances,
    refetchInterval: 3000,
    ...options,
  })
}

export const useEvents = (limit = 200) => {
  return useQuery({
    queryKey: ["events", limit],
    queryFn: () => fetchEvents(limit),
    refetchInterval: 1000,
  })
}

export const useProcessing = () => {
  return useQuery({
    queryKey: ["processing"],
    queryFn: fetchProcessing,
    refetchInterval: 1000,
  })
}

export const useModels = () => {
  return useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
    refetchInterval: 3000,
  })
}

export const useInstanceModels = (fullName: string | null) => {
  return useQuery({
    queryKey: ["instanceModels", fullName],
    queryFn: () => fetchInstanceModels(fullName!),
    enabled: !!fullName,
    staleTime: 0,
  })
}

export const useSystemPrompt = () => {
  return useQuery({
    queryKey: ["systemPrompt"],
    queryFn: fetchSystemPrompt,
    staleTime: 0,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export const useDeployInstance = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deployInstance,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instances"] }),
  })
}

export const useBanInstance = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ fullName, seconds }: { fullName: string; seconds?: number }) =>
      banInstance(fullName, seconds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instances"] }),
  })
}

export const useUnbanInstance = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: unbanInstance,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instances"] }),
  })
}

export const useStartInstance = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: startInstance,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instances"] }),
  })
}

export const useStopInstance = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: stopInstance,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instances"] }),
  })
}

export const useRemoveInstance = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeInstance,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instances"] }),
  })
}

export const useUpdateInstance = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ fullName, ...updates }: { fullName: string; is_local?: boolean; base_url?: string; active?: boolean }) =>
      updateInstance(fullName, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instances"] }),
  })
}

export const useSetMainNode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setMainNode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instances"] })
      queryClient.invalidateQueries({ queryKey: ["models"] }) // "mollama" appears/disappears
    },
  })
}

export const useUnsetMainNode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: unsetMainNode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instances"] })
      queryClient.invalidateQueries({ queryKey: ["models"] })
    },
  })
}

export const useSaveSystemPrompt = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveSystemPrompt,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["systemPrompt"] }),
  })
}

export const useDeleteModel = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ instance, model }: { instance: string; model: string }) =>
      deleteModel(instance, model),
    onSuccess: (_, { instance }) => {
      queryClient.invalidateQueries({ queryKey: ["instanceModels", instance] })
      queryClient.invalidateQueries({ queryKey: ["models"] })
    },
  })
}