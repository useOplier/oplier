"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteSystem, getSystem, listSystems, pauseSystem, resumeSystem } from "@/lib/api/client";

export function useSystems() {
  return useQuery({ queryKey: ["systems"], queryFn: listSystems });
}

export function useSystem(id: string) {
  return useQuery({ queryKey: ["systems", id], queryFn: () => getSystem(id), enabled: !!id });
}

export function useSystemActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["systems"] });
  const pause = useMutation({ mutationFn: pauseSystem, onSuccess: invalidate });
  const resume = useMutation({ mutationFn: resumeSystem, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: deleteSystem, onSuccess: invalidate });
  return { pause, resume, remove };
}
