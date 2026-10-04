"""Runs one analysis end to end: build the message, call Gemini, check the format, save the run, print a summary.

Run from the project root:
  python scripts/run_analysis.py [--today YYYY-MM-DD] [--focus TEXT] [--notes TEXT] [--demo] [--dry-run] [--use-cache]
  python scripts/run_analysis.py --list-models

  --demo         use data/demo/config.json and data/demo/inputs.json instead of your working files
  --dry-run      print the user message and stop (no Gemini call)
  --use-cache    skip Gemini and show the latest good run (or the demo result)
  --list-models  print the models the client would try, in order (no analysis call)
"""

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.format_check import check_result  # noqa: E402
from backend.gemini_client import (  # noqa: E402
    SettingsError, analyze, candidate_models, fallback, load_settings, make_client, save_run,
)
from backend.message_builder import build_user_message  # noqa: E402
from backend.storage import CONFIG_PATH, DATA, INPUTS_PATH, ROOT, load_config, load_decisions, load_inputs  # noqa: E402


def fmt(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, (int, float)):
        return f"{v:+d}" if isinstance(v, int) and v else str(v)
    return str(v)


def print_model(analysis) -> None:
    meta = analysis.result.get("_meta") if isinstance(analysis.result, dict) else None
    meta = meta if isinstance(meta, dict) else {}
    if analysis.source == "gemini":
        took = f" in {meta['seconds_total']} s" if meta.get("seconds_total") is not None else ""
        print(f"Analysed with {analysis.model}{took}")
    else:
        original = meta.get("model") or "unknown model"
        print(f"Source: cached result from {analysis.cache_path}, originally analysed with {original}")
    attempts = meta.get("attempts") or []
    if attempts and analysis.source == "gemini":
        print("Attempts: " + "; ".join(f"{a.get('model')} {a.get('outcome')} ({a.get('seconds')} s)" for a in attempts))


def print_summary(result: dict) -> None:
    if not isinstance(result, dict):
        return
    print("\nBriefing:\n  " + str(result.get("executive_briefing", "(none)")))
    rows = result.get("balance_matrix") or []
    if rows:
        print(f"\n  {'Region':<8} {'Segment':<16} {'Demand':>6} {'EffSup':>6} {'Gap':>4}  Status")
        for r in rows:
            if isinstance(r, dict):
                print(f"  {fmt(r.get('region')):<8} {fmt(r.get('segment')):<16} {fmt(r.get('demand')):>6} "
                      f"{fmt(r.get('effective_supply')):>6} {fmt(r.get('gap')):>4}  {fmt(r.get('status'))}")
    count = lambda k: len(result.get(k) or [])
    illus = result.get("illustrative_influence") or {}
    ids = sorted({i.get("card_id", "?") for i in illus.get("items") or [] if isinstance(i, dict)}) \
        if isinstance(illus, dict) else []
    print(f"\nRecommendations: {count('recommendations')}   Cross-region effects: {count('cross_region_effects')}   "
          f"Global comparison notes: {count('global_comparison_commentary')}   Illustrative cards: {len(ids)}")
    if ids:
        print("ILLUSTRATIVE inputs influenced this result:\n    " + "\n    ".join(ids))


def list_models() -> int:
    settings = load_settings()
    models = candidate_models(settings, make_client(settings))
    print(f"The client would try these {len(models)} model(s), in order:")
    for i, (name, origin) in enumerate(models, 1):
        print(f"  {i:>2}. {name:<45} ({origin})")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--today", default=date.today().isoformat())
    ap.add_argument("--focus", default="")
    ap.add_argument("--notes", default="")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--use-cache", action="store_true")
    ap.add_argument("--list-models", action="store_true")
    args = ap.parse_args()

    try:
        if args.list_models:
            return list_models()
        return run(args)
    except SettingsError as e:  # includes KeyProblem
        print(f"Stopped: {e}", file=sys.stderr)
        return 1


def run(args) -> int:
    config_path, inputs_path = (DATA / "demo" / "config.json", DATA / "demo" / "inputs.json") if args.demo \
        else (CONFIG_PATH, INPUTS_PATH)
    config, cards = load_config(config_path), load_inputs(inputs_path)
    message = build_user_message(config, cards, load_decisions(), today=args.today, focus=args.focus, notes=args.notes)
    print(f"Inputs: {config_path.relative_to(ROOT)}, {inputs_path.relative_to(ROOT)}  "
          f"(user message {len(message):,} characters)")
    if args.dry_run:
        print("\n" + message)
        return 0

    if args.use_cache:
        analysis = fallback("Cached result requested (--use-cache).")
    else:
        settings = load_settings()
        first = settings.model or "the first available model"
        p = settings.public()
        thinking = (f"thinking budget {p['thinking_budget']}" if p["thinking_budget"] is not None
                    else f"thinking level {p['thinking_level']}" if p["thinking_level"] else "thinking: model default")
        print(f"Calling Gemini, starting with {first} (call timeout {p['call_timeout_s']} s, "
              f"total budget {p['total_budget_s']} s, {thinking}). This can take a few minutes...", flush=True)
        analysis = analyze(message, settings=settings)

    format_warnings = check_result(analysis.result, config, cards)
    print_model(analysis)
    if analysis.source == "gemini":
        print(f"Saved: {save_run(analysis, format_warnings).relative_to(ROOT)}")
    print_summary(analysis.result)
    warnings = analysis.warnings + format_warnings
    print(f"\nWarnings ({len(warnings)}):" if warnings else "\nNo warnings.")
    for w in warnings:
        print(f"  - {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
