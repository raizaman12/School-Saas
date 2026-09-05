"use client";

import { useEffect, useState } from "react";

/**
 * Debounces a fast-changing value (typically a search input) so dependent
 * effects — API calls, in this app — only fire after the user pauses
 * typing. Without this, every keystroke in a search box triggers a fresh
 * network request, which is wasteful on the low-bandwidth mobile
 * connections much of this app's target audience uses.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
