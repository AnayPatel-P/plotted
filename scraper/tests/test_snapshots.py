"""Snapshot tests: parse saved catalog pages and compare with committed JSON.

If a parser change is intentional, regenerate with:
    UPDATE_SNAPSHOTS=1 uv run pytest tests/test_snapshots.py
and review the diff in tests/snapshots/.
"""

import gzip
import json
import os
import re
from dataclasses import asdict, is_dataclass
from pathlib import Path

import pytest

from plotted_scraper import tamu, ut_courses, ut_program
from plotted_scraper.prereq import SubjectMap

HERE = Path(__file__).parent
FIX = HERE / "fixtures"
SNAP = HERE / "snapshots"
UPDATE = os.environ.get("UPDATE_SNAPSHOTS") == "1"

UT_SUBJECTS = SubjectMap(
    {
        "Computer Science": "C S",
        "Mathematics": "M",
        "Statistics and Data Sciences": "SDS",
        "Physics": "PHY",
        "Electrical and Computer Engineering": "ECE",
        "Linguistics": "LIN",
        "Philosophy": "PHL",
    }
)


def html(name: str) -> str:
    return gzip.decompress((FIX / f"{name}.html.gz").read_bytes()).decode("utf-8")


def check(name: str, value) -> None:
    if is_dataclass(value):
        value = asdict(value)
    text = json.dumps(value, indent=1, ensure_ascii=False, sort_keys=True) + "\n"
    path = SNAP / f"{name}.json"
    if UPDATE or not path.exists():
        SNAP.mkdir(exist_ok=True)
        path.write_text(text)
        if not UPDATE:
            pytest.skip(f"wrote new snapshot {path.name}")
    assert json.loads(text) == json.loads(path.read_text()), (
        f"{name} changed; rerun with UPDATE_SNAPSHOTS=1 if intended"
    )


@pytest.mark.parametrize("name", ["ut-cs-bs", "ut-math-bs"])
def test_ut_program(name):
    check(name, ut_program.parse_program_page(html(name)))


def test_ut_courses():
    courses, flags = ut_courses.parse_subject_page(html("ut-courses-c_s"), UT_SUBJECTS)
    check("ut-courses-c_s", {"courses": courses, "flags": flags})


def test_tamu_program():
    check("tamu-daen-bs", tamu.parse_program_page(html("tamu-daen-bs")))


def test_tamu_courses():
    page = html("tamu-courses-csce")
    codes = sorted(set(re.findall(r"\b([A-Z]{3,4}) \d{3}", page)))
    courses, flags = tamu.parse_subject_page(page, SubjectMap({c: c for c in codes}), {})
    check("tamu-courses-csce", {"courses": courses, "flags": flags})
