"use client";

import { useQuery } from "@tanstack/react-query";
import { getInsights, getPortfolio } from "@/lib/api/client";

export function usePortfolio() {
  return useQuery({ queryKey: ["portfolio"], queryFn: getPortfolio });
}

export function useInsights() {
  return useQuery({ queryKey: ["insights"], queryFn: getInsights });
}
