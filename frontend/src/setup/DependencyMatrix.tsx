import { useEffect } from "react";
import { FieldErrors } from "../components/FieldErrors";
import type { Config } from "../types";
import { setDependency } from "./configEdit";

interface Props {
  regions: string[];
  dependency: Config["supply_dependency"];
  onChange: (dependency: Config["supply_dependency"]) => void;
  onValidityChange?: (valid: boolean) => void;
  serverErrors?: Record<string, string[] | undefined>; // by consuming region
}

const EPS = 1e-9;

/** Supply dependency sliders. Rows = consuming region, columns = origin; the diagonal shows the own share (1 - row sum). */
export function DependencyMatrix({ regions, dependency, onChange, onValidityChange, serverErrors }: Props) {
  const rowSum = (r: string) => regions.filter((o) => o !== r).reduce((s, o) => s + (dependency[r]?.[o] ?? 0), 0);
  const allValid = regions.every((r) => rowSum(r) <= 1 + EPS);

  useEffect(() => {
    onValidityChange?.(allValid);
  }, [allValid, onValidityChange]);

  return (
    <div className="tblwrap">
      <table className="depmatrix">
        <thead>
          <tr>
            <th scope="col">Consuming region</th>
            {regions.map((o) => (
              <th key={o} scope="col">
                from {o}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {regions.map((r) => {
            const sum = rowSum(r);
            const bad = sum > 1 + EPS;
            const errId = `dep-err-${r}`;
            return (
              <tr key={r} className={bad ? "bad" : undefined}>
                <th scope="row">
                  {r}
                  {bad && (
                    <p id={errId} className="field-error" role="alert">
                      Shares from other regions add up to {sum.toFixed(2)}; the total must be 1 or less.
                    </p>
                  )}
                  <FieldErrors messages={serverErrors?.[r]} />
                </th>
                {regions.map((o) =>
                  o === r ? (
                    <td key={o} title="Own share = 1 minus the shares from other regions">
                      <span className="own" data-testid={`own-${r}`}>{bad ? "–" : (1 - sum).toFixed(2)}</span>
                      <div className="small muted">own share</div>
                    </td>
                  ) : (
                    <td key={o}>
                      <div className="slider-cell">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={dependency[r]?.[o] ?? 0}
                          aria-label={`Share of ${r} electronics sourced from ${o}`}
                          aria-describedby={bad ? errId : undefined}
                          aria-invalid={bad || undefined}
                          onChange={(e) => onChange(setDependency(dependency, r, o, Number(e.target.value)))}
                        />
                        <output>{(dependency[r]?.[o] ?? 0).toFixed(2)}</output>
                      </div>
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
