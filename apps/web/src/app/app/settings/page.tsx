"use client";

import { useEffect, useState } from "react";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
];

export default function SettingsPage() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  const [memorySummary, setMemorySummary] = useState("");
  const [slippage, setSlippage] = useState("1");

  useEffect(() => {
    if (settings.data) {
      setMemorySummary(settings.data.memorySummary);
      setSlippage(String(settings.data.maxSlippagePercent));
    }
  }, [settings.data]);

  if (settings.isLoading || !settings.data) {
    return (
      <div className="shell max-w-lg space-y-6 py-6 sm:py-10">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  const dirty =
    memorySummary !== settings.data.memorySummary || slippage !== String(settings.data.maxSlippagePercent);

  return (
    <div className="shell max-w-lg py-6 sm:py-10">
      <h1 className="text-lg font-semibold text-ink">Settings</h1>

      {/* Memory */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">Memory</p>
            <p className="mt-0.5 text-xs text-slate">
              Lets Oplier remember preferences and context across chats.
            </p>
          </div>
          <Switch
            checked={settings.data.memoryEnabled}
            onCheckedChange={(checked) => updateSettings.mutate({ memoryEnabled: checked })}
          />
        </div>
        {settings.data.memoryEnabled && (
          <Textarea
            rows={5}
            className="mt-3"
            value={memorySummary}
            onChange={(e) => setMemorySummary(e.target.value)}
            placeholder="Nothing remembered yet."
          />
        )}
      </section>

      {/* Timezone */}
      <section className="mt-8">
        <p className="text-sm font-semibold text-ink">Timezone</p>
        <p className="mt-0.5 text-xs text-slate">Used to display execution and activity timestamps.</p>
        <select
          value={settings.data.timezone}
          onChange={(e) => updateSettings.mutate({ timezone: e.target.value })}
          className="mt-3 h-10 w-full rounded-md border border-slate-line bg-white px-3 text-sm text-ink"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </section>

      {/* Max slippage */}
      <section className="mt-8">
        <p className="text-sm font-semibold text-ink">Max slippage</p>
        <p className="mt-0.5 text-xs text-slate">Applied to transactions and UPM executions. Default 1%.</p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            className="w-24"
          />
          <span className="text-sm text-slate">%</span>
        </div>
      </section>

      {dirty && (
        <div className="mt-8 flex justify-end">
          <Button
            size="sm"
            onClick={() =>
              updateSettings.mutate({ memorySummary, maxSlippagePercent: Number(slippage) || 1 })
            }
            disabled={updateSettings.isPending}
          >
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
