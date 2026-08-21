import Image from "next/image";
import { cn } from "@/lib/utils";

export function Wordmark({ className, height = 28 }: { className?: string; height?: number }) {
  // Intrinsic ratio of wordmark.svg is 450:150 (3:1) — width derives from height.
  const width = Math.round(height * 3);
  return (
    <Image
      src="/wordmark.svg"
      alt="Oplier"
      width={width}
      height={height}
      className={cn("select-none", className)}
      priority
    />
  );
}
