"use client";

import { useQuery } from "@tanstack/react-query";
import { listPositions } from "@/lib/api/client";

export function usePositions() {
  return useQuery({ queryKey: ["positions"], queryFn: listPositions });
}
