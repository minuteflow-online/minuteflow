"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Keeps a tab/view switcher in sync with a URL query param, so refreshing
// the page (or sharing/bookmarking the URL) lands back on the same tab
// instead of resetting to the default. Other existing query params are
// preserved. Uses router.replace (not push) so switching tabs doesn't spam
// browser history.
export function useUrlTab<T extends string>(paramName: string, defaultValue: T, validValues?: readonly T[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const readFromUrl = useCallback((): T => {
    const raw = searchParams.get(paramName);
    if (raw && (!validValues || (validValues as readonly string[]).includes(raw))) return raw as T;
    return defaultValue;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, paramName]);

  const [value, setValueState] = useState<T>(readFromUrl);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Stay in sync with back/forward navigation or external URL changes.
  useEffect(() => {
    const next = readFromUrl();
    if (next !== valueRef.current) setValueState(next);
  }, [readFromUrl]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultValue) params.delete(paramName);
      else params.set(paramName, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, paramName, defaultValue]
  );

  return [value, setValue] as const;
}
