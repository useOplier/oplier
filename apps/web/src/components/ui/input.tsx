import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-slate-line bg-white px-3 text-sm text-ink placeholder:text-slate focus-visible:border-ink/30",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
