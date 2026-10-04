import type { Categories, Side } from "../types";

interface Props {
  side: Side;
  categories: Categories;
  active: string[];
  onChange: (active: string[]) => void;
}

/** ABB's 8 categories of one side; at most max_active_per_side active, at least one. Unticked cards keep their values. */
export function CategoryPicker({ side, categories, active, onChange }: Props) {
  const max = categories.max_active_per_side;
  const list = categories[side];
  const activeHere = list.filter((c) => active.includes(c.name)).length;
  const full = activeHere >= max;
  return (
    <fieldset className="picker" aria-describedby={`picker-note-${side}`}>
      <legend className="sr-only">{side === "demand" ? "Demand" : "Supply"} categories</legend>
      <div className="picker-grid">
        {list.map((c) => {
          const on = active.includes(c.name);
          const disabled = (!on && full) || (on && activeHere === 1);
          return (
            <label key={c.name} className={disabled && !on ? "off" : undefined}>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => onChange(on ? active.filter((a) => a !== c.name) : [...active, c.name])}
              />
              <span>
                {c.name}
                {c.abb_internal && <span className="chip internal" style={{ marginLeft: 6 }}>ABB internal</span>}
              </span>
            </label>
          );
        })}
      </div>
      <p className="field-note" id={`picker-note-${side}`} role="status">
        {activeHere} of max {max} active.
        {full && ` Untick one to choose another.`}
        {activeHere === 1 && ` At least one ${side} category must stay active.`} Unticked categories keep their values.
      </p>
    </fieldset>
  );
}
