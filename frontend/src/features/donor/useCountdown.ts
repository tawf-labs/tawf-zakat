import { useEffect, useState } from "react";
import { nowInSeconds } from "./donorClient";

/** Whole seconds left until `until` (Unix seconds), ticking once a second. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(nowInSeconds);
  useEffect(() => {
    if (until === null) return;
    setNow(nowInSeconds());
    const timer = setInterval(() => setNow(nowInSeconds()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, until - now);
}
