import type { ReactNode } from "react";

/** A dashboard panel with a heading. Sections decide themselves whether to render (return null when empty). */
export function Section({ id, title, children, note }: { id: string; title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="panel" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {note && <p className="small muted" style={{ marginTop: -4 }}>{note}</p>}
      {children}
    </section>
  );
}

export function Chips({ ids, className = "chip" }: { ids: string[]; className?: string }) {
  if (!ids.length) return null;
  return (
    <>
      {ids.map((id) => (
        <span key={id} className={className} title={id}>
          {id}
        </span>
      ))}
    </>
  );
}
