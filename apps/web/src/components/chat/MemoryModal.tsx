"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Brain } from "lucide-react";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";

export function MemoryModal() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (settings.data) setDraft(settings.data.memorySummary);
  }, [settings.data]);

  function handleSave() {
    updateSettings.mutate({ memorySummary: draft }, { onSuccess: () => setOpen(false) });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate transition-colors hover:bg-ink/[0.05] hover:text-ink"
          aria-label="Memory"
        >
          <Brain className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent title="Memory" description="What Oplier remembers about you across every chat.">
        {!settings.data?.memoryEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-slate">
              Memory is turned off, so nothing from this conversation is being remembered.
            </p>
            <Link href="/app/settings" className="text-sm font-medium text-accent-dim hover:underline">
              Turn it on in Settings →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <Textarea
              rows={7}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Nothing remembered yet."
            />
            <p className="text-xs text-slate">
              Edit or delete anything you don&apos;t want Oplier to keep. This doesn&apos;t control your
              UPMs. Allocation amounts always come from what you explicitly enter.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateSettings.isPending}>
                Save changes
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
