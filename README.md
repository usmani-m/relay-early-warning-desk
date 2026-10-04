# Relay Early-Warning Desk

## Setup

Create the environment file:

```bash
cp .env.example .env
```

Create and activate a virtual environment:

**Mac/Linux**

```bash
python -m venv .venv
source .venv/bin/activate
```

**Windows**

```bash
python -m venv .venv
.venv\Scripts\activate
```

Install the required packages:

```bash
pip install -r requirements.txt
```

Initialize Git if it hasn't already been done:

```bash
git init
```

Then check:

```bash
git status
```

Make sure `.env` is not listed as an untracked file.

## Running the project

Open the project folder in VS Code and follow the instructions in:

```text
docs/setup.md
```

## Project files

* `CLAUDE.md` — project brief and development guidelines.
* `data/signals.json` — contains the demo signals used by the project.
* `data/demo_result.json` — saved demo result for testing.
* `reference/ui_prototype.html` — the current UI prototype. Open it in a browser to see the interface.
