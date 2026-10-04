import type { ReactNode } from "react";

interface Props {
  dirty: boolean;
  saving: boolean;
  blockedReason?: string | null; // why Save is disabled (shown inline)
  savedNote?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  children?: ReactNode; // extra buttons on the right
}

export function SaveBar({ dirty, saving, blockedReason, savedNote, onSave, onDiscard, children }: Props) {
  return (
    <div className="savebar" role="region" aria-label="Save changes">
      <span className={dirty ? "pill dirty" : "pill saved"} aria-live="polite">
        {dirty ? "Unsaved changes" : savedNote || "All changes saved"}
      </span>
      <button type="button" className="primary" onClick={onSave} disabled={!dirty || saving || !!blockedReason}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onDiscard} disabled={!dirty || saving}>
        Discard
      </button>
      {blockedReason && dirty && <span className="field-error" style={{ margin: 0 }}>{blockedReason}</span>}
      <span className="spacer" />
      {children}
    </div>
  );
}
