"use client";

import { ListChecks } from "lucide-react";
import { useSystems } from "@/hooks/useSystems";
import { SystemCard } from "@/components/systems/SystemCard";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SystemsPage() {
  const systems = useSystems();

  return (
    <div className="shell max-w-3xl py-6 sm:py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Systems</h1>
        <Button size="sm" asChild>
          <Link href="/app/chat">New UPM</Link>
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {systems.isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        {systems.data?.length === 0 && (
          <div className="sm:col-span-2">
            <EmptyState
              icon={ListChecks}
              title="No UPMs yet"
              description="Ask Oplier in Chat to create a system that manages a position for you automatically."
              action={
                <Button size="sm" asChild>
                  <Link href="/app/chat">Go to Chat</Link>
                </Button>
              }
            />
          </div>
        )}
        {systems.data?.map((system) => (
          <SystemCard key={system.id} system={system} />
        ))}
      </div>
    </div>
  );
}
