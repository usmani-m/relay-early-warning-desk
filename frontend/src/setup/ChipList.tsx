import { useEffect, useRef, useState } from "react";
import type { Kind } from "./configEdit";
import { nameProblem } from "./configEdit";

interface Props {
  kind: Kind;
  names: string[];
  onAdd: (name: string) => void;
  onRename: (oldName: string, newName: string) => Promise<void>;
  onRequestDelete: (name: string) => void;
}

/** Regions or segments as a row of chips; a chip opens a popover with Rename and Delete; "+" adds. */
export function ChipList({ kind, names, onAdd, onRename, onRequestDelete }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addTouched, setAddTouched] = useState(false);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const popRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);

  const close = (focusChip = true) => {
    const name = open;
    setOpen(null);
    setRenaming(false);
    setError(null);
    if (focusChip && name) window.setTimeout(() => chipRefs.current[name]?.focus(), 0);
  };

  // Esc or a click outside closes the popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !chipRefs.current[open]?.contains(t)) close(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => popRef.current?.querySelector<HTMLElement>("button, input")?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const renameProblem = open && renaming ? nameProblem(value, names, kind, open) : null;
  const addProblem = nameProblem(newName, names, kind);

  async function submitRename() {
    if (!open || renameProblem) return;
    if (value.trim() === open) return close();
    setBusy(true);
    setError(null);
    try {
      await onRename(open, value.trim());
      const renamed = value.trim();
      setOpen(null);
      setRenaming(false);
      window.setTimeout(() => chipRefs.current[renamed]?.focus(), 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chiprow" role="list" aria-label={kind === "region" ? "Regions" : "Segments"}>
      {names.map((n) => (
        <span key={n} className="chip-wrap" role="listitem">
          <button
            type="button"
            ref={(el) => {
              chipRefs.current[n] = el;
            }}
            className={`chip-btn${open === n ? " open" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={open === n}
            onClick={() => {
              if (open === n) return close();
              setOpen(n);
              setRenaming(false);
              setValue(n);
            }}
          >
            {n}
          </button>
          {open === n && (
            <div ref={popRef} className="popover" role="dialog" aria-label={`${n} options`}>
              {!renaming ? (
                <>
                  <div className="row">
                    <button type="button" className="small" onClick={() => setRenaming(true)}>Rename</button>
                    <button
                      type="button"
                      className="small danger"
                      disabled={names.length <= 1}
                      title={names.length <= 1 ? `Keep at least one ${kind}.` : undefined}
                      onClick={() => {
                        close(false);
                        onRequestDelete(n);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitRename();
                  }}
                >
                  <label className="small muted" htmlFor={`rename-${kind}-${n}`}>New name (values are kept)</label>
                  <input id={`rename-${kind}-${n}`} value={value} className={renameProblem ? "invalid" : undefined} onChange={(e) => setValue(e.target.value)} />
                  {renameProblem && <p className="field-error">{renameProblem}</p>}
                  {error && <p className="field-error">{error}</p>}
                  <div className="row" style={{ marginTop: 6 }}>
                    <button type="submit" className="small primary" disabled={!!renameProblem || busy}>{busy ? "Renaming…" : "Rename"}</button>
                    <button type="button" className="small" onClick={() => close()} disabled={busy}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          )}
        </span>
      ))}
      {adding ? (
        <form
          className="chip-add"
          role="listitem"
          onSubmit={(e) => {
            e.preventDefault();
            setAddTouched(true);
            if (addProblem) return;
            onAdd(newName);
            setNewName("");
            setAddTouched(false);
            setAdding(false);
            window.setTimeout(() => plusRef.current?.focus(), 0);
          }}
        >
          <label className="sr-only" htmlFor={`add-${kind}`}>New {kind} name</label>
          <input
            id={`add-${kind}`}
            autoFocus
            placeholder={`New ${kind}`}
            value={newName}
            className={addTouched && addProblem ? "invalid" : undefined}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setNewName("");
                setAddTouched(false);
              }
            }}
          />
          <button type="submit" className="small">Add</button>
          <button type="button" className="small" onClick={() => { setAdding(false); setNewName(""); setAddTouched(false); }}>Cancel</button>
          {addTouched && addProblem && <span className="field-error" style={{ margin: 0 }}>{addProblem}</span>}
        </form>
      ) : (
        <span role="listitem">
          <button type="button" ref={plusRef} className="chip-btn plus" aria-label={`Add ${kind}`} onClick={() => setAdding(true)}>+</button>
        </span>
      )}
    </div>
  );
}
