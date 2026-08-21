"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "form" | "success";

/**
 * Small link below the hero CTA that opens a two-state Web3Forms modal.
 * Submission follows Web3Forms' documented client-side pattern exactly:
 * append `access_key` to the form's FormData and POST to their endpoint.
 * The access key is a client-embeddable identifier by design (not a secret
 * like the project's other credentials), so it's fine in
 * NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY.
 */
export function NotifyMainnetCta() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset after the close animation so the form doesn't visibly flash
      // back to its first state while the dialog is still fading out.
      setTimeout(() => {
        setStep("form");
        setError(null);
      }, 200);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      formData.append("access_key", process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY ?? "");
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setStep("success");
      } else {
        setError(data.message || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className="text-sm font-medium text-ink underline-offset-4 transition-colors hover:text-accent hover:underline">
          Get notified when we launch on mainnet
        </button>
      </DialogTrigger>
      <DialogContent
        title={step === "success" ? "You'll be notified!" : "Be First on Mainnet"}
        description={step === "form" ? "Get notified the moment we go live on mainnet." : undefined}
      >
        {step === "form" ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="notify-name" className="text-xs font-medium text-slate">
                Name
              </label>
              <Input id="notify-name" name="name" required placeholder="Your name" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="notify-email" className="text-xs font-medium text-slate">
                Email
              </label>
              <Input id="notify-email" name="email" type="email" required placeholder="you@example.com" />
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Sending..." : "Notify me"}
            </Button>
          </form>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
