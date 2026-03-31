import { useState, useEffect } from "react";
import { getLocalDate } from "../lib/share";

/**
 * Returns the current local date string (YYYY-MM-DD) as reactive state.
 * Polls every 30s and checks on visibilitychange so midnight resets propagate.
 */
export function useDateCheck(): string {
  const [today, setToday] = useState(getLocalDate);

  useEffect(() => {
    const check = () => {
      const now = getLocalDate();
      setToday((prev) => (prev !== now ? now : prev));
    };

    const id = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return today;
}
