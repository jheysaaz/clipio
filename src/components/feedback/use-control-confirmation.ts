import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives a short, purely informational confirmation next to the control that
 * caused it. The confirmation itself is never an action, so it may fade; the
 * timer is cleaned up on unmount so a closed popup cannot set state later.
 */
export function useControlConfirmation(durationMs = 2000) {
  const [confirmed, setConfirmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const show = useCallback(() => {
    clear();
    setConfirmed(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setConfirmed(false);
    }, durationMs);
  }, [clear, durationMs]);

  const reset = useCallback(() => {
    clear();
    setConfirmed(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { confirmed, show, reset };
}
