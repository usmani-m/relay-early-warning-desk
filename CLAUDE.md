# Relay supply early-warning desk

Hackathon prototype for the ABB Distribution Solutions challenge "From weak signals to proactive decisions".
A planner rates market and supply-chain evidence with sliders; an AI system (Gemini) turns those inputs into
scenarios and procurement recommendations for a human planner. The structure follows ABB's "Vision for the solution":
1. connected ecosystem data, 2. AI agents platform, 3. decision areas, 4. optimisation objectives, 5. outcomes.

## Stack
- Backend: Python 3.11+, FastAPI, uvicorn, google-genai, pydantic v2, python-dotenv, pytest
- Frontend: React + Vite + TypeScript
- Storage: plain JSON files in `data/` (no database)
- Runs locally on a laptop for the demo

## Folder layout (target)
```
CLAUDE.md
.env                      # GEMINI_API_KEY, GEMINI_MODEL, GEMINI_MAX_OUTPUT_TOKENS (never commit)
prompts/system_prompt.md  # the system prompt; single source of truth for the output schema
data/config.json          # regions, segments, active categories, dependencies, weights
data/inputs.json          # input cards (slider values + evidence)
data/decisions.json       # planner decisions (approve / adjust / reject)
data/demo/                # demo config.json + inputs.json (built by scripts/build_demo_inputs.py) + demo_result.json (a saved real run)
data/signals.json         # original real-source signals; source for the demo inputs (do not delete)
data/demo_result.json     # OLD-format result (9-point scale); source for build_demo_inputs.py and last-resort fallback
data/runs/                # every Gemini result, timestamped (git-ignored)
reference/ui_prototype.html  # single-file prototype: design and behaviour reference
backend/                  # data model, message builder, Gemini client, FastAPI app
frontend/                 # React app
scripts/                  # helper scripts
tests/                    # pytest
```

## Division of work (important)
- **Gemini does the whole analysis**, including all arithmetic (averages, blended supply, pool pressure, gaps,
  global comparison, worst-case action selection, weighted objective scores) and the cross-region uncertainty assessment.
  The formulas live in `prompts/system_prompt.md` so Gemini applies them consistently.
- **The backend does no analysis.** It only: stores config and inputs, keeps input cards in sync, builds the user message,
  calls Gemini, and runs a light format check. There is NO calculation engine, NO Monte Carlo, NO `/api/compute`,
  and NO post-processing that recomputes or overwrites Gemini's numbers.
- The format check only reports warnings and never changes the result: valid JSON, required keys present,
  every score within −3..+3.

## Scale (inputs AND outputs everywhere)
+3 strongly favorable, +2 favorable, +1 slightly favorable, 0 neutral, −1 slightly unfavorable, −2 unfavorable, −3 strongly unfavorable.
- Demand: + = growing demand for ABB products.
- Supply: + = LOOSE supply, − = TIGHT supply.
- "No data" (`null`) is a separate state and is never treated as 0.
- Rounding: always round half away from zero, then clip to [−3, 3].
- All inputs are entered with sliders (no raw numbers).
- Display: the UI shows scale **names**, never the numbers ("Favorable", "Unfavorable (tight)" for supply; helpers
  `levelName` in `frontend/src/result/normalize.ts` and `plainLabel` in `frontend/src/scale.ts`). Levels stay integers in
  the data and in Gemini's JSON; Gemini's intermediate decimals are only in a collapsed "Gemini's calculation" table.
  The system prompt asks Gemini to use scale names, not "+2", in all free text.

## Data model (JSON files in `data/`, pydantic models in `backend/models.py`)
`config.json`
- `regions: [str]`, `segments: [str]` — dynamic (add, rename, delete). Defaults: EUROPE, AMER, APAC, MEA; Infrastructure, Utilities, Industry.
  `GLOBAL` is reserved and cannot be a region name.
- `active_datasets`: 1–3 demand + 1–3 supply categories, exact ABB names (`backend/categories.py`).
- `supply_dependency: {region: {other_region: 0..1}}` = share of a region's key electronics sourced from the other region.
  No self-entry; row sum ≤ 1; own share = 1 − row sum.
- `demand_competition: {region: 0..1}` = how strongly that region's demand draws on the shared global component pool.
- `pool_pressure_factor`: number ≥ 0, default 0.5.
- `policy_weights: {profitability, customer_value, growth, resilience}` in %, sum 100 (default 30/25/25/20;
  Gemini uses the disruption set 20/35/15/30 when any effective supply ≤ −2).
- `dependencies_are_examples: bool` — true for the demo values; the UI labels them as examples.

`inputs.json`: list of input cards
- `id, side (demand|supply), dataset, region (region name or "GLOBAL"), segment (demand only; null for supply)`
- `level: −3..3 or null (no data)`, `confidence: low|medium|high`
- `evidence_note, source_url, date, is_illustrative`
- Card ids are readable and deterministic: `D|<region>|<segment>|<dataset>` and `S|<region>|<dataset>`. Gemini cites them.
- Cards exist for: region × segment × active demand category; region × active supply category;
  GLOBAL × segment × active demand category; GLOBAL × active supply category.
- `backend/inputs_sync.py` creates missing cards (level null) and removes cards of deleted regions/segments, keeping all
  existing values. Cards of **deactivated categories are kept dormant** (not sent to Gemini) so toggling doesn't lose values.
  Renaming a region/segment rewrites card ids and dependency/competition keys.

`decisions.json`: list of `{as_of, region, segment, recommendation, decision, note}`.

## Gemini call (backend only)
- SDK: `from google import genai`; `genai.Client(api_key=...)`; `client.models.generate_content(...)`
- `system_instruction` = contents of `prompts/system_prompt.md`
- `contents` = user message with these blocks, in order:
  `<context>` (today, focus, regions, segments, active_datasets, notes),
  `<inputs>` (cards in active categories only, regional rows: id, side, dataset, region, segment, level, confidence,
  evidence_note, source_url, date, is_illustrative),
  `<global_baseline>` (the GLOBAL cards), `<dependencies>` (supply_dependency with own shares, demand_competition,
  pool_pressure_factor), `<feedback>` (past decisions or "none yet"), `<policy>` (objective weights).
- Config: `response_mime_type="application/json"`, `temperature=0.2`, `max_output_tokens` and model from `.env`.
- Strip ```json fences before parsing. Retry once on invalid JSON. If it fails again (or the API errors), return a
  cached result with `source: "cache"` and a clear warning. Fallback order: latest `data/runs/*.json` with source gemini →
  `data/demo/demo_result.json` → `data/demo_result.json` (old format, flagged). Timeout about 180 s.
- Model chain: `GEMINI_MODEL` (optional) → `GEMINI_FALLBACK_MODELS` (optional, comma-separated) → models discovered via
  `client.models.list()` (generateContent text models only; flash > pro > flash-lite, stable > preview/exp, newest first;
  cached per session). Busy (503/429/5xx): wait 10 s, retry once, next model. 404/not supported: next model. Invalid JSON:
  retry once, next model. 401/403 or "API key not valid": stop with a key message (no cache). Per-call timeout
  `GEMINI_CALL_TIMEOUT` (default 300 s), total budget `GEMINI_TOTAL_BUDGET` (default 480 s), then cache.
  Optional `GEMINI_THINKING_BUDGET` (tokens; 0 off, -1 auto) or `GEMINI_THINKING_LEVEL` (minimal|low|medium|high), not
  both; a model that rejects it (400 mentioning "thinking") is retried once without it. `_meta.settings` records them.
  The result gets `_meta: {model, attempts, generated_at}`; the dashboard shows "Analysed with <model>".
  `python scripts/run_analysis.py --list-models` prints the order.
- `.env` is loaded from the project root only; a missing key stops with the line to add. Only Gemini results
  are saved to `data/runs/` (`{saved_at, model, source, warnings, result}`).
- Code: `backend/message_builder.py`, `backend/gemini_client.py`, `backend/format_check.py`, `scripts/run_analysis.py`.

## System prompt requirements (`prompts/system_prompt.md`)
- Keep ABB's vision structure (5 sections, 6 agents, orchestration, knowledge graph, human in the loop, capabilities,
  7 decision areas with all 21 questions, 4 objectives, 6 outcomes) and all ground rules.
- 7-point scale everywhere, including all output scores and JSON schema examples.
- Formulas in the prompt for Gemini to apply: confidence weights (high 3, medium 2, low 1); confidence-weighted demand per
  region × segment and supply per region; blended supply via supply_dependency (own share = 1 − row sum); pool pressure from
  demand_competition × pool_pressure_factor; effective supply; gap = (demand − effective supply) / 2, round half away from zero,
  clip; 7 gap statuses (+3 shortage critical, +2 shortage risk, +1 watch (shortage), 0 balanced, −1 watch (excess),
  −2 excess risk, −3 excess critical, plus insufficient data); global comparison (region − GLOBAL: well above ≥2, above 1,
  in line 0, below −1, well below ≤−2); worst-case action selection (tie-break: likelihood-weighted, low 1 / medium 2 / high 3);
  weighted objective scores.
- Output shows key numbers per cell (demand, effective supply, gap, status) so the dashboard can display them.
- `cross_region_effects`: Gemini's own assessment, from the dependency sliders and confidence levels, of which region's
  uncertainty affects which other region, how strongly (low|medium|high), and what it means for procurement.
- `global_comparison_commentary`: where regions diverge from the global trend and why it matters.
- Illustrative inputs must be named as illustrative wherever they influence a conclusion.

## Backend API
`backend/main.py` (`create_app(...)`, `app`), jobs in `backend/jobs.py`. Errors: `{"detail": ["readable message", ...]}`.
- `GET  /api/health` → `{status, env_file, has_key, has_model, job_running}` (booleans only, never values)
- `GET  /api/categories` → 16 categories, ABB-internal marked
- `GET/PUT /api/config` (PUT validates, re-syncs and saves input cards); `POST /api/config/rename {kind, old, new}` keeps values
- `GET/PUT /api/inputs` (PUT: 422 on unknown region/segment or duplicate card)
- `POST /api/demo/reset` copies `data/demo/` config + inputs over `data/` (409 while a job runs; decisions kept)
- `POST /api/analyze {today?, focus, notes, use_cache}` → `{job_id, state, already_running}`; one job at a time.
  `use_cache` → a job already `done` with the demo result, `source: "cache"`.
- `GET  /api/analyze/{job_id}` → `{state: running|done|failed|cancelled, progress: {model, attempt, models_tried,
  last_outcome}, elapsed_s, result, warnings, source, meta, error, run_id}`; `POST /api/analyze/{job_id}/cancel`
  (an in-flight HTTP call can't be aborted; its late result is discarded)
- `GET  /api/results` (list), `/api/results/latest`, `/api/results/demo`, `/api/results/{run_id}`
  → `{run_id, saved_at, model, source, warnings, result}`
- `GET  /api/decisions`, `POST /api/decisions` (feed `<feedback>` on the next run). POST is an upsert on
  `(as_of, region, segment, recommendation)`: changing a decision replaces it.
- `PUT  /api/policy-weights` changes only `config.policy_weights` (Run tab); Setup's Save keeps the server's weights.
- Results carry an **inputs snapshot** (`inputs`: active cards with a value that were sent): saved in each run file,
  returned by jobs and `/api/results/*`; `/api/results/demo` attaches `data/demo/inputs.json`; older runs → `null`.

## Frontend (layout from `reference/ui_prototype.html`; ABB brand styling, light mode default, dark mode available)
No vendor name in the UI: never show "Gemini" or model names; say "AI". `hideVendor()` in `src/result/normalize.ts`
filters every result and backend message on screen (keeps .env setting names like GEMINI_API_KEY so config errors stay
fixable). Backend, saved runs and the CLI keep the real model names.
Brand: ABB Red #FF000F only for accents (header line, active-tab underline, critical accent); text and primary buttons
use #E0000E (AA with white). Black/white/light greys, Inter font, no condensed font, no logo. **All colours, fonts and the
type scale live in `frontend/src/tokens.css`** (light + `[data-theme="dark"]`); other CSS uses tokens only, enforced by
`src/__tests__/tokens.test.ts` (WCAG AA contrast of every text/background pair in both themes). Statuses: shortage
critical red, shortage risk orange, watch yellow, balanced green, excess blue, insufficient grey, each with an icon and label.
Tabs: Setup, Inputs, Run analysis, Dashboard. Calls `/api` via Vite proxy to http://localhost:8000; never sees the API key.
Implementation (Phase 4): React 18 + Vite 8 + TypeScript 7, plain CSS (`src/tokens.css` + `styles.css`, `dashboard.css`, `editor.css`), Vitest +
Testing Library. `src/api.ts` = typed client for every endpoint; `src/types.ts` mirrors `backend/models.py`.
`src/setup/` (SetupTab, ChipList with Rename/Delete popover, DependencyMatrix, configEdit helpers incl. the
plain-language structure line), `src/inputs/` (InputsTab, InputCardEditor, CategoryPicker, cards.ts with the card-id
rule, importValidation), `src/components/` (LevelSlider with a distinct no-data state and plain labels per side,
Segmented, ConfirmDialog, SaveBar, Toggletip). Tabs stay mounted (no lost drafts); Setup save/reset is blocked while Inputs has unsaved changes.
Rename goes straight to `POST /api/config/rename`; add/delete apply on Save. No calculations in the frontend beyond the
displayed own share (1 − row sum) and filled-card counts.
Phase 5: `src/run/RunTab.tsx` (fields, weights → `PUT /api/policy-weights`, cached switch on by default, polling every
2 s, Cancel, history). `src/result/` = result types from the system-prompt schema + `normalizeResult` (never throws on
partial/old results) + the 7 statuses. `src/dashboard/` = one component per section; every section returns null when
its data is missing. The app opens on the latest saved run, else the demo result. Decisions are keyed on
`(as_of, region, segment, recommendation=action)`; Adjust requires a note. Styles for both in `src/dashboard.css`.
- Setup (compact): regions and segments as plain chips ("+" to add; chip popover Rename/Delete; the delete confirmation states how many filled cards are lost);
  one "?" toggletip per section; active categories as a read-only line ("Change on the Inputs tab"); supply chain
  structure collapsed to one plain line per region ("AMER: 50% own, 40% APAC, 10% EUROPE"), "Edit structure" opens the
  dependency matrix (own share, error if row sum > 1), demand competition and pool pressure factor. Save keeps the
  server's active_datasets and policy_weights.
- Inputs (one selection at a time): sticky bar with Region (GLOBAL first) and Segment selects, unsaved indicator and Save; selection in the hash (`#inputs/EUROPE/Utilities`).
  Demand and supply sections with category chips and an inline picker (max 3; unticked cards keep values; new categories
  get no-data placeholder cards; Save = PUT inputs, then PUT config with only active_datasets changed). Supply note
  "applies to all <region> segments" and the GLOBAL-fallback note when a region has no supply values. Card: big level or
  "No data", plain label ("Unfavorable: tight" / "Favorable: clear growth"), Clear to no data, confidence, evidence,
  https source (blocks Save, problems elsewhere listed with jump buttons), date, illustrative (dashed border).
  Export/import JSON at the bottom. No overview grid.
- Run analysis: today, focus, notes; objective weight sliders (sum 100, inline error); Run with progress and Stop;
  "Use cached result" switch; warnings list.
- Dashboard: everything from the prototype (chain, briefing, early warnings, stats, filters, balance matrix, evidence,
  PESTLE, scenarios, action table, recommendations with Approve/Adjust/Reject, decision areas, agent trail, outcomes,
  data gaps, feedback loop) adapted to dynamic regions/segments and the 7-point scale, plus a Global comparison panel,
  a Cross-region effects panel, and a banner when any illustrative input influenced the result. Balance matrix comes from Gemini's output.

## Demo data
- `scripts/build_demo_inputs.py` converts `data/signals.json` + the assessment in `data/demo_result.json` into
  `data/demo/config.json` and `data/demo/inputs.json` (and copies them to `data/`). Old score → level: round_half_away(score × 3 / 100).
- The three supply inputs (S7, S8, S9) are illustrative. Dependencies are plausible examples, labelled as such.
- `ILLUSTRATIVE_EXAMPLES` in the script adds unsourced example values so the demo shows cross-region effects: the three
  APAC supply cards (−2, medium) and `D|AMER|Infrastructure|Project pipelines & permitting` (+1, low). All `is_illustrative`.
- No new sources. Everything else without a source is `null`.
- `data/demo/demo_result.json` is a real run of `python scripts/run_analysis.py --demo`, copied as-is from `data/runs/`
  (the loader unwraps the run file); never hand-converted. `demo_result_backup.json` is an earlier real run.

## Decisions made
1. Deactivated categories: cards are kept dormant, not sent. Deleting a region or segment deletes its cards.
2. One card per region × segment × category. Where two demo signals fall on one card they are combined once at
   conversion with the confidence-weighted rule, and the evidence note says so.
3. Card ids are readable strings so Gemini can cite them.
4. The format check does not verify Gemini's arithmetic; it flags only format problems: missing keys, out-of-range scores,
   missing categories, decision areas without 3 questions, recommendations without human approval, not exactly one
   recommendation per cell with |gap| ≥ 2 (ordered by priority), and (given config + cards) illustrative cards feeding the
   matrix missing from `illustrative_influence` and supply-dependency links missing from `cross_region_effects`.

## Phases (stop after each so the user can test and commit)
1. CLAUDE.md, data model, card sync, storage, demo inputs, pytest tests.
2. System prompt, user-message builder, Gemini client, format check, CLI script for one run (demo result = a saved real run).
3. FastAPI endpoints.
4. Frontend Setup and Inputs tabs.
5. Run analysis tab and full Dashboard.
6. Demo hardening: offline mode with cache, startup checks for .env and model name, README "How to run the demo".

## Hard rules
- Never print, log, hard-code or commit the API key. Read it from `.env` only.
- Never invent data. Illustrative inputs must stay visibly marked in the UI.
- Keep the 16 dataset names exactly as in ABB's vision.
- The system prompt file is the source of truth for the output schema; do not change the schema without updating it.

## Commands
- Tests: `python -m pytest -q` (venv active)
- Demo inputs: `python scripts/build_demo_inputs.py`, check with `python scripts/show_inputs.py`
- One analysis: `python scripts/run_analysis.py [--demo] [--dry-run] [--use-cache] [--today ...] [--focus ...] [--notes ...]`
- Backend: `.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000` (from the project root);
  try every endpoint at http://localhost:8000/docs
- Always call `.venv\Scripts\python.exe` directly on this machine (a plain `python` resolved to another interpreter).
- Git root is the parent folder `relay-early-warning-desk-starter/`; its own `.gitignore` excludes `.env` and `.venv/`.
- Frontend: `cd frontend`, `npm install` (first time), `npm run dev` → http://localhost:5173; tests `npm test`;
  typecheck + build `npm run build`
- Both at once: `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1` (backend in a new window, frontend here)
- List models: `python scripts/list_models.py`

## Working style
- Plan before coding; work in small steps; run and test each step; tell me what to commit.
- When something fails, explain the cause before changing code.
