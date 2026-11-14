import { useEffect, useRef, useState, type ReactNode } from "react";

/** How long the previous file stays on screen before a slow open shows its spinner. */
export const HOLD_PREVIOUS_MS = 400;

/**
 * Keeps the last ready view on screen while the next one loads, like VS Code:
 * switching files then goes straight from one file to the other, without a
 * spinner flashing in between. A load slower than HOLD_PREVIOUS_MS still shows
 * its own loading state. The held view is inert, so a keystroke cannot land in
 * a file that is on its way out.
 *
 * The wrapper is always the same element, so the editor inside it is not
 * remounted when the held view gives way to the new one.
 */
export function HoldWhileLoading({
  contentKey,
  ready,
  children,
}: {
  contentKey: string;
  ready: boolean;
  children: ReactNode;
}) {
  const held = useRef<{ key: string; node: ReactNode } | null>(null);
  const [expiredKey, setExpiredKey] = useState<string | null>(null);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setExpiredKey(contentKey), HOLD_PREVIOUS_MS);
    return () => window.clearTimeout(timer);
  }, [contentKey, ready]);

  const previous = held.current;
  const holding =
    !ready && previous !== null && previous.key !== contentKey && expiredKey !== contentKey;
  if (ready) held.current = { key: contentKey, node: children };

  return (
    <div className="flex min-h-0 flex-1 flex-col" inert={holding} aria-busy={!ready}>
      {holding ? previous.node : children}
    </div>
  );
}
