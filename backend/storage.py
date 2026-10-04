"""Load and save the JSON files in data/. Writes are atomic (temp file, then replace)."""

import json
import os
import re
import tempfile
from pathlib import Path

from backend.models import Config, Decision, InputCard

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG_PATH = DATA / "config.json"
INPUTS_PATH = DATA / "inputs.json"
DECISIONS_PATH = DATA / "decisions.json"


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


RUN_ID = re.compile(r"^\d{8}-\d{6}(-\d+)?$")


def run_files(runs_dir: Path) -> list[Path]:
    """Saved run files (data/runs/<YYYYMMDD-HHMMSS>[-n].json), newest first."""
    if not runs_dir.exists():
        return []
    files = [p for p in runs_dir.glob("*.json") if RUN_ID.match(p.stem)]

    def key(p: Path):
        day, time_, *n = p.stem.split("-")
        return day, time_, int(n[0]) if n else 1

    return sorted(files, key=key, reverse=True)


def load_config(path: Path = CONFIG_PATH) -> Config:
    return Config.model_validate(read_json(path, {}))


def save_config(config: Config, path: Path = CONFIG_PATH) -> None:
    write_json(path, config.model_dump())


def load_inputs(path: Path = INPUTS_PATH) -> list[InputCard]:
    return [InputCard.model_validate(c) for c in read_json(path, [])]


def save_inputs(cards: list[InputCard], path: Path = INPUTS_PATH) -> None:
    write_json(path, [c.model_dump() for c in cards])


def load_decisions(path: Path = DECISIONS_PATH) -> list[Decision]:
    return [Decision.model_validate(d) for d in read_json(path, [])]


def save_decisions(decisions: list[Decision], path: Path = DECISIONS_PATH) -> None:
    write_json(path, [d.model_dump() for d in decisions])
