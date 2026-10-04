import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirm built on <dialog> (focus stays inside, Esc cancels). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open && (
        <>
          <h2 id="confirm-title">{title}</h2>
          <div>{children}</div>
          <div className="actions">
            <button type="button" onClick={onCancel} autoFocus>
              Cancel
            </button>
            <button type="button" className={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
