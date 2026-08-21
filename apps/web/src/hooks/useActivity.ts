"use client";

import { useQuery } from "@tanstack/react-query";
import { listActivity } from "@/lib/api/client";

export function useActivity() {
  return useQuery({ queryKey: ["activity"], queryFn: () => listActivity() });
}
