import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded-md border border-slate-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate focus-visible:border-ink/30",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
