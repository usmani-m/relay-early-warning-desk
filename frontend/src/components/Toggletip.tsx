import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/** A "?" button that shows a short help text (click or Enter to toggle, Esc or outside click to close). */
export function Toggletip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="tip-wrap" ref={wrap}>
      <button type="button" className="tip-btn" aria-label={`Help: ${label}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        ?
      </button>
      {open && (
        <span id={id} role="status" className="tip">
          {children}
        </span>
      )}
    </span>
  );
}
