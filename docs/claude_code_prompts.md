> Superseded by the phases in CLAUDE.md.

# Prompts to give Claude Code, step by step

Start each step in plan mode, read the plan, then approve. Commit to Git after each step works.

## Step 1: Gemini connection (backend only)
> Read CLAUDE.md. Create the Python backend skeleton in `backend/` with a `gemini_client.py` that builds the user message
> from `data/signals.json` (active categories only) exactly as described, calls Gemini with the system prompt, parses the JSON
> and saves it to `data/runs/<timestamp>.json`. Add a script `scripts/run_once.py` so I can test it from the terminal
> without any web server. Add `requirements.txt`. Do not build the API or frontend yet.

Test: `python scripts/run_once.py` → a JSON file appears in `data/runs/`.

## Step 2: Validation
> Add `backend/validate.py` implementing every validation rule in CLAUDE.md. It returns a list of warnings and never raises.
> Add the retry-once and fallback-to-cache logic. Add a few pytest tests using `data/demo_result.json` and a deliberately broken copy.

## Step 3: FastAPI endpoints
> Build `backend/main.py` with all endpoints listed in CLAUDE.md, using JSON files for storage. Enable CORS for
> http://localhost:5173. Show me how to test each endpoint in the browser at /docs.

## Step 4: Frontend skeleton
> Create a React + Vite + TypeScript app in `frontend/` with a Vite proxy for /api. Recreate the header, tabs, colour tokens,
> fonts and light/dark mode from `reference/ui_prototype.html`. Only the layout and tabs, no data yet.

## Step 5: Signals and Run analysis tabs
> Implement the Signals tab (16 categories with max 3 active per side, signal table, add-signal form with validation,
> JSON import/export) and the Run analysis tab (context fields, Run button calling POST /api/analyze, progress state,
> "Use cached result" switch, warnings display). Match the reference prototype.

## Step 6: Dashboard
> Implement the Dashboard from the reference prototype, reading the latest result: banner with briefing and early warnings,
> stats, data used, filters, balance matrix (clickable), signals with score bars, evidence check, PESTLE coverage, scenarios,
> action evaluation table, recommendations with Approve/Adjust/Reject (saved via /api/decisions), decision areas,
> agent trail, outcomes and data gaps. Hide any section the result does not contain.

## Step 7: Demo hardening
> Add a startup check that tells me if .env is missing or the model name is invalid. Make the app fully usable with
> `use_cache=true` and no internet. Write a short README section "How to run the demo".
