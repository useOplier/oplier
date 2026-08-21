"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSettings, updateSettings } from "@/lib/api/client";
import type { SettingsResponse } from "@/lib/api/types";

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: getSettings });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsResponse>) => updateSettings(patch),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}
