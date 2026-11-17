"""UT Austin program pages (CourseLeaf: catalog.utexas.edu/undergraduate/programs/<slug>/).

Two things come out of a program page:
  * the Plan of Study grid  -> suggestedPlan (terms with courses and slots)
  * the requirement tables  -> requirement areas (rule trees)

Anything the generic parser can't express is recorded in `review` so a person
can fix it in the program's overrides file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup, Tag

Rule = dict[str, Any]

CODE_RE = re.compile(r"^[A-Z][A-Z ]{0,5}? ?\d{3}[A-Z]?$")


@dataclass
class Row:
    kind: str  # "course" | "or" | "comment" | "sum" | "header"
    codes: list[str] = field(default_factory=list)
    text: str = ""
    hours: float | None = None
    indent: int = 0
    classes: list[str] = field(default_factory=list)


def _hours(td: Tag | None) -> float | None:
    if td is None:
        return None
    m = re.search(r"\d+(?:\.\d+)?", td.get_text(" ", strip=True))
    return float(m.group()) if m else None


def _rows(table: Tag) -> list[Row]:
    out: list[Row] = []
    for tr in table.find_all("tr"):
        classes = tr.get("class", []) or []
        if "hidden" in classes:
            continue
        tds = tr.find_all(["td", "th"])
        if not tds:
            continue
        hours = _hours(tr.find("td", class_="hourscol"))
        indent_div = tr.find("div", class_="blockindent")
        indent = 0
        if indent_div is not None:
            m = re.search(r"margin-left:\s*(\d+)px", indent_div.get("style", ""))
            indent = int(m.group(1)) // 20 if m else 1
        codes = [" ".join(a.get_text(" ", strip=True).split()) for a in tr.select("a.code")]
        text = " ".join(tr.get_text(" ", strip=True).split())
        if "listsum" in classes or "plangridsum" in classes or "plangridtotal" in classes:
            kind = "sum"
        elif "areaheader" in classes or "areasubheader" in classes:
            kind = "header"
        elif "orclass" in classes:
            kind = "or"
        elif codes:
            kind = "course"
        else:
            kind = "comment"
        out.append(Row(kind, codes, text, hours, indent, classes))
    return out


# ---------------------------------------------------------------------------
# Slot filters: turn placeholder text into a course filter.
# ---------------------------------------------------------------------------


def guess_filter(label: str) -> dict[str, Any] | None:
    """Best-effort filter for a placeholder label. None = needs a human."""
    core = re.search(r"\((0\d\d)\)", label)
    if core:
        return {"core": [core.group(1)]}
    m = re.search(r"upper-division ([A-Z][A-Z ]*[A-Z])\b", label, re.IGNORECASE)
    if m and m.group(1).isupper():
        return {"subjects": [m.group(1)], "upperDivision": True}
    if re.search(r"upper-division computer science", label, re.IGNORECASE):
        return {"subjects": ["C S"], "upperDivision": True}
    if re.search(r"free elective", label, re.IGNORECASE):
        return {"any": True}
    return None


# ---------------------------------------------------------------------------
# Plan of Study
# ---------------------------------------------------------------------------


def parse_plan(table: Tag, review: list[str]) -> list[dict]:
    terms: list[dict] = []
    year = 0
    for row in _rows(table):
        if "plangridyear" in row.classes:
            m = re.search(r"\d+", row.text)
            year = int(m.group()) if m else year + 1
            continue
        if "plangridterm" in row.classes:
            m = re.search(r"Semester (\d)", row.text)
            sem = int(m.group(1)) if m else len(terms) % 2 + 1
            season = {1: "Fall", 2: "Spring"}.get(sem, "Summer")
            terms.append({"id": f"y{year}-{season.lower()}", "label": f"Year {year} · {season}", "items": []})
            continue
        if row.kind == "sum" or not terms:
            continue
        items = terms[-1]["items"]
        n = len(items) + 1
        tid = terms[-1]["id"]
        if row.codes:
            item: dict[str, Any] = {"kind": "course", "id": f"{tid}-{n}", "code": row.codes[0]}
            if len(row.codes) > 1:
                item["alternatives"] = row.codes[1:]
            items.append(item)
        else:
            # "Hours chosen from: Upper-division C S | 3" or "U.S. History (060) | 3"
            label = re.sub(r"\s*\d+(\.\d+)?$", "", row.text).replace("Hours chosen from:", "").strip(" |")
            label = re.sub(r"\s*\|\s*", " ", label).strip()
            flt = guess_filter(label)
            if flt is None:
                review.append(f"plan slot '{label}' in {terms[-1]['label']}: filter needs review")
                flt = {"any": True}
            items.append(
                {"kind": "slot", "id": f"{tid}-{n}", "label": label, "credits": row.hours or 3, "filter": flt}
            )
    return terms


# ---------------------------------------------------------------------------
# Requirement tables -> rule trees
# ---------------------------------------------------------------------------


def parse_requirement_table(table: Tag, area_id: str, review: list[str]) -> list[Rule]:
    """Generic parser: course rows, 'or' alternatives, 'Choose a sequence' groups,
    'Hours chosen from' credit rules. Deeper nesting is flagged for review."""
    rules: list[Rule] = []
    group: Rule | None = None  # current nOf ("Choose a sequence below")
    seq: Rule | None = None  # current allOf inside the group
    last_course: Rule | None = None
    counter = 0

    def next_id() -> str:
        nonlocal counter
        counter += 1
        return f"{area_id}.r{counter}"

    def close_group() -> None:
        nonlocal group, seq
        group, seq = None, None

    for row in _rows(table):
        if row.kind in ("sum", "header"):
            continue
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
                close_group()
                rules.append(course)
            continue

        text = row.text
        last_course = None
        if re.match(
            r"^(Choose|Select) (a|one) (sequence|of the following)", text, re.IGNORECASE
        ) and not re.search(r"foreign|language", text, re.IGNORECASE):
            close_group()
            group = {
                "type": "nOf",
                "id": next_id(),
                "label": text.rstrip(": 0123456789"),
                "n": 1,
                "rules": [],
            }
            rules.append(group)
            continue
        if group is not None and re.match(r"^Sequence \d+:?$", text):
            seq = {
                "type": "allOf",
                "id": f"{group['id']}.s{len(group['rules']) + 1}",
                "label": text.rstrip(":"),
                "rules": [],
            }
            group["rules"].append(seq)
            continue
        if group is not None and re.match(r"^(Sequence \d+: .*|PART [A-Z]|AND PART [A-Z])", text):
            review.append(
                f"{area_id}: nested choice '{text}' inside '{group['label']}' needs a hand-written rule"
            )
            seq = {
                "type": "manual",
                "id": f"{group['id']}.s{len(group['rules']) + 1}",
                "label": text,
                "note": "nested choice; see overrides",
            }
            group["rules"].append(seq)
            seq = None
            continue
        m = re.match(r"^Hours chosen from:?\s*(.*?)\s*(\d+)?$", text)
        if m and row.hours:
            close_group()
            label = m.group(1) or "Hours chosen from list"
            flt = guess_filter(label)
            rid = next_id()
            if flt is None:
                review.append(f"{rid} '{label}' ({row.hours:g} hrs): filter needs review")
                rules.append({"type": "manual", "id": rid, "label": f"{label} ({row.hours:g} hours)"})
            else:
                rules.append(
                    {"type": "credits", "id": rid, "label": label, "hours": row.hours, "filter": flt}
                )
            continue
        if group is not None and seq is not None:
            continue  # stray comment inside a sequence
        close_group()
        if text:
            rid = next_id()
            review.append(f"{rid} '{text}': not parsed (kept as manual check)")
            rules.append({"type": "manual", "id": rid, "label": text})
    return rules


@dataclass
class ProgramPage:
    title: str
    total_hours: float | None
    plan: list[dict]
    tables: dict[str, list[Rule]]  # heading -> rules
    review: list[str]


def parse_program_page(html: str) -> ProgramPage:
    soup = BeautifulSoup(html, "lxml")
    title = soup.find("h1", id="page-title").get_text(" ", strip=True)
    container = soup.find(id="requirementstextcontainer")
    review: list[str] = []
    m = re.search(r"Total Hours Required:\s*(\d+)", container.get_text(" "))
    total = float(m.group(1)) if m else None

    plan: list[dict] = []
    tables: dict[str, list[Rule]] = {}
    heading = ""
    for el in container.find_all(["h2", "h3", "table"]):
        if el.name in ("h2", "h3"):
            heading = el.get_text(" ", strip=True)
            continue
        classes = el.get("class", [])
        if "sc_plangrid" in classes or heading == "Plan of Study":
            plan = parse_plan(el, review)
        elif "sc_courselist" in classes and heading.startswith(("Major", "Degree")):
            area = "major" if heading.startswith("Major") else "degree"
            tables[heading] = parse_requirement_table(el, area, review)
    return ProgramPage(title, total, plan, tables, review)
