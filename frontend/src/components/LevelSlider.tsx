import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { LEVELS, LEVEL_LABELS, PLAIN_MEANING, plainLabel } from "../scale";

interface Props {
  value: number | null; // null = no data, shown differently from 0
  onChange: (value: number | null) => void;
  label: string; // accessible name, e.g. the card's dataset
  side?: "demand" | "supply";
}

const clamp = (v: number) => Math.max(-3, Math.min(3, v));

/** 7-point slider (strongly unfavorable .. strongly favorable) with a separate "no data" state. Keyboard: arrows, Home/End, Enter/Space (set 0), Delete (clear). */
export function LevelSlider({ value, onChange, label, side }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function levelAt(clientX: number): number | null {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const fraction = (clientX - rect.left) / rect.width;
    return clamp(Math.round(fraction * 6) - 3);
  }

  function onKeyDown(e: KeyboardEvent) {
    let next: number | null | undefined;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
      case "PageUp":
        next = value === null ? 1 : clamp(value + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
      case "PageDown":
        next = value === null ? -1 : clamp(value - 1);
        break;
      case "Home":
        next = -3;
        break;
      case "End":
        next = 3;
        break;
      case "Enter":
      case " ":
        if (value === null) next = 0;
        break;
      case "Delete":
      case "Backspace":
        next = null;
        break;
    }
    if (next !== undefined) {
      e.preventDefault();
      if (next !== value) onChange(next);
    }
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const lv = levelAt(e.clientX);
    if (lv !== null && lv !== value) onChange(lv);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const lv = levelAt(e.clientX);
    if (lv !== null && lv !== value) onChange(lv);
  }

  const meaning = plainLabel(value, side);
  const text = meaning; // "Unfavorable: tight" or "No data"
  const name = value === null ? "No data" : LEVEL_LABELS[value][0].toUpperCase() + LEVEL_LABELS[value].slice(1);
  const position = (lv: number) => `${((lv + 3) / 6) * 100}%`;

  return (
    <div className="lvl">
      <div className="lvl-top">
        <span className={value === null ? "lvl-big none" : `lvl-big ${value > 0 ? "pos" : value < 0 ? "neg" : ""}`} data-testid="level-number" aria-hidden="true">
          {name}
        </span>
        {value !== null && (
          <button type="button" className="link small" onClick={() => onChange(null)}>
            Clear to no data
          </button>
        )}
      </div>
      <div className={value === null ? "lvl-value none" : "lvl-value"} data-testid="level-text">
        {value === null ? "Nothing known yet" : side ? PLAIN_MEANING[side][value] : ""}
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={-3}
        aria-valuemax={3}
        aria-valuenow={value ?? undefined}
        aria-valuetext={text}
        className={value === null ? "lvl-track none" : "lvl-track"}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {LEVELS.map((lv) => (
          <span key={lv} className={lv === 0 ? "lvl-stop mid" : "lvl-stop"} style={{ left: position(lv) }} />
        ))}
        {value !== null && (
          <span className={`lvl-thumb ${value > 0 ? "pos" : value < 0 ? "neg" : ""}`} style={{ left: position(value) }} />
        )}
      </div>
      <div className="lvl-scale" aria-hidden="true">
        <span>Strongly unfavorable</span>
        <span>Neutral</span>
        <span>Strongly favorable</span>
      </div>
      {value === null && <div className="lvl-hint">Click the scale or use the arrow keys to set a value.</div>}
    </div>
  );
}
