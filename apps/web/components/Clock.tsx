"use client";

import { useEffect, useState } from "react";

export function useNow(intervalMs = 15_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Clock() {
  const now = useNow();
  return (
    <div className="clock" aria-live="off">
      <div className="clock__time">
        {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : " "}
      </div>
      <div className="clock__date">
        {now ? now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) : " "}
      </div>
    </div>
  );
}

export function partOfDay(date: Date | null): { greeting: string; when: string } {
  const h = date?.getHours() ?? 12;
  if (h < 5) return { greeting: "Good evening", when: "tonight" };
  if (h < 12) return { greeting: "Good morning", when: "today" };
  if (h < 17) return { greeting: "Good afternoon", when: "today" };
  return { greeting: "Good evening", when: "tonight" };
}
