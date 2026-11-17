"""UT Austin program pages (CourseLeaf: catalog.utexas.edu/undergraduate/programs/<slug>/).

Two things come out of a program page:
  * the Plan of Study grid  -> suggestedPlan (terms with courses and slots)
  * the requirement tables  -> requirement areas (rule trees)

Requirement tables come in two places: the "Requirements" overview table
(split into areas by its header rows, e.g. "Concentration") and the detail
tables under "Major-..." / "Degree-..." headings.

Anything the generic parser can't express is recorded in `review` so a person
can fix it in the program's overrides file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from bs4 import BeautifulSoup, Tag

from .courseleaf import Row, Rule, guess_filter, norm, parse_plan, rows

CHOICE_RE = re.compile(
    r"^((Choose|Select) (a|one) (sequence|of the following)|Hours chosen from a single sequence)",
    re.IGNORECASE,
)
SEQ_RE = re.compile(r"^Sequence \d+:?$")
NESTED_RE = re.compile(r"^(Sequence \d+: .*|PART [A-Z]|AND PART [A-Z])")
POOL_RE = re.compile(r"^Hours chosen from:?\s*(.*?)\s*(\d+)?$")


def _strip_hours(text: str) -> str:
    return re.sub(r"\s*\d+(\.\d+)?$", "", text).strip()


def parse_requirement_rows(table_rows: list[Row], area_id: str, review: list[str]) -> list[Rule]:
    """Course rows, 'or' alternatives, 'Choose a sequence' groups, and 'Hours
    chosen from' pools (credit-hour rules over the indented courses that follow).
    Deeper nesting is flagged for review."""
    rules: list[Rule] = []
    group: Rule | None = None  # nOf for "Choose a sequence below"
    seq: Rule | None = None  # allOf inside the group
    pool: dict[str, Any] | None = None  # "Hours chosen from" in progress
    last_course: Rule | None = None
    counter = 0

    def next_id() -> str:
        nonlocal counter
        counter += 1
        return f"{area_id}.r{counter}"

    def close_pool() -> None:
        nonlocal pool
        if pool is None:
            return
        p, pool = pool, None
        label = p["label"]
        if p["codes"] and not p["comments"]:
            rules.append(
                {
                    "type": "credits",
                    "id": p["id"],
                    "label": label or "Hours from list",
                    "hours": p["hours"],
                    "filter": {"codes": p["codes"]},
                }
            )
            return
        flt = guess_filter(label) if label else None
        if flt is not None and not p["comments"]:
            rules.append(
                {"type": "credits", "id": p["id"], "label": label, "hours": p["hours"], "filter": flt}
            )
            return
        detail = ", ".join(p["comments"]) if p["comments"] else ""
        full = f"{label or 'Hours chosen from'}{': ' + detail if detail else ''} ({p['hours']:g} hours)"
        review.append(f"{p['id']} '{full}': filter needs review")
        rules.append({"type": "manual", "id": p["id"], "label": full})

    def close_all() -> None:
        nonlocal group, seq
        close_pool()
        group, seq = None, None

    for row in table_rows:
        if row.kind in ("sum", "header") or row.text.lower().startswith("free electives"):
            close_all()
            continue  # free electives are covered by the total-hours rule

        # Inside a pool: indented rows belong to it.
        if pool is not None and row.indent > 0:
            if row.kind in ("course", "or"):
                pool["codes"] += row.codes
            elif row.text and not row.text.lower().startswith("courses listed may"):
                pool["comments"].append(row.text)
            continue
        if pool is not None:
            close_pool()

        if row.kind == "or" and last_course is not None and row.codes:
            last_course.setdefault("alternatives", []).extend(row.codes)
            continue
        if row.kind == "course":
            course: Rule = {"type": "course", "id": next_id(), "code": row.codes[0]}
            if len(row.codes) > 1:
                course["alternatives"] = row.codes[1:]
            last_course = course
            if group is not None and row.indent > 0 and seq is not None:
                seq["rules"].append(course)
            else:
                close_all()
                rules.append(course)
            continue

        text = row.text
        last_course = None
        if CHOICE_RE.match(text) and not re.search(r"foreign|language", text, re.IGNORECASE):
            close_all()
            group = {
                "type": "nOf",
                "id": next_id(),
                "label": _strip_hours(text).rstrip(":"),
                "n": 1,
                "rules": [],
            }
            rules.append(group)
            continue
        if group is not None and SEQ_RE.match(text):
            seq = {
                "type": "allOf",
                "id": f"{group['id']}.s{len(group['rules']) + 1}",
                "label": text.rstrip(":"),
                "rules": [],
            }
            group["rules"].append(seq)
            continue
        if group is not None and NESTED_RE.match(text):
            review.append(
                f"{group['id']}: nested choice '{text}' inside '{group['label']}' needs a hand-written rule"
            )
            group["rules"].append(
                {
                    "type": "manual",
                    "id": f"{group['id']}.s{len(group['rules']) + 1}",
                    "label": text,
                    "note": "nested choice; see overrides",
                }
            )
            seq = None
            continue
        m = POOL_RE.match(text)
        if m and row.hours:
            close_all()
            pool = {
                "id": next_id(),
                "label": norm(m.group(1)).strip("()"),
                "hours": row.hours,
                "codes": [],
                "comments": [],
            }
            continue
        if group is not None and seq is not None:
            continue  # stray comment inside a sequence
        close_all()
        if not text:
            continue
        rid = next_id()
        label = _strip_hours(text)
        flt = guess_filter(label)
        if row.hours and flt is not None:
            rules.append({"type": "credits", "id": rid, "label": label, "hours": row.hours, "filter": flt})
        else:
            hours = f" ({row.hours:g} hours)" if row.hours else ""
            review.append(f"{rid} '{label}{hours}': not parsed (kept as manual check)")
            rules.append({"type": "manual", "id": rid, "label": f"{label}{hours}"})
    close_pool()
    return rules


def split_overview(table: Tag) -> dict[str, list[Row]]:
    """Split the Requirements overview table into areas by its header rows."""
    areas: dict[str, list[Row]] = {}
    current: str | None = None
    for row in rows(table):
        if "areaheader" in row.classes:
            current = _strip_hours(row.text)
            areas[current] = []
            continue
        if "areasubheader" in row.classes or row.kind == "sum":
            continue
        if current is not None:
            areas[current].append(row)
    return areas


@dataclass
class ProgramPage:
    title: str
    total_hours: float | None
    plan: list[dict]
    tables: dict[str, list[Rule]]  # heading or overview area -> rules
    review: list[str]


def parse_program_page(html: str) -> ProgramPage:
    soup = BeautifulSoup(html, "lxml")
    title = norm(soup.find("h1", id="page-title").get_text(" "))
    container = soup.find(id="requirementstextcontainer")
    review: list[str] = []
    m = re.search(r"Total Hours Required:\s*(\d+)", container.get_text(" "))
    total = float(m.group(1)) if m else None

    plan: list[dict] = []
    tables: dict[str, list[Rule]] = {}
    heading = ""
    for el in container.find_all(["h2", "h3", "table"]):
        if el.name in ("h2", "h3"):
            heading = norm(el.get_text(" "))
            continue
        classes = el.get("class", [])
        if "sc_plangrid" in classes:
            plan = parse_plan(el, review)
        elif "sc_courselist" in classes and heading == "Requirements":
            for area, area_rows in split_overview(el).items():
                if area.lower().startswith("concentration"):
                    tables[f"Overview: {area}"] = parse_requirement_rows(area_rows, "conc", review)
        elif "sc_courselist" in classes and heading.startswith(("Major", "Degree")):
            area_id = "major" if heading.startswith("Major") else "degree"
            tables[heading] = parse_requirement_rows(rows(el), area_id, review)
    return ProgramPage(title, total, plan, tables, review)
