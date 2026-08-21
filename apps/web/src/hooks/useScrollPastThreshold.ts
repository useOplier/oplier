"use client";

import { useEffect, useState, type RefObject } from "react";

export function useScrollPastThreshold(ref: RefObject<HTMLElement | null>, fraction = 0.7) {
  const [past, setPast] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let ticking = false;
    const check = () => {
      ticking = false;
      const rect = el.getBoundingClientRect();
      const scrolledPast = rect.top <= -(rect.height * fraction);
      setPast(scrolledPast);
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(check);
      }
    };

    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, fraction]);

  return past;
}
