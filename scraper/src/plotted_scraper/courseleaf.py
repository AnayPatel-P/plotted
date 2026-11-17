"""Shared parsing for CourseLeaf catalogs (UT Austin, Texas A&M, and many others).

CourseLeaf renders requirement lists as `table.sc_courselist` and semester
plans as `table.sc_plangrid`; footnotes live in `dl.sc_footnotes`. Schools
differ in what they put in those tables, so school adapters (ut_*.py,
tamu.py) build on these helpers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from bs4 import Tag

Rule = dict[str, Any]

YEAR_WORDS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
TEXAS_CORE = ["010", "020", "030", "040", "050", "060", "070", "080", "090", "093"]


def norm(text: str) -> str:
    """Collapse whitespace (including non-breaking spaces and zero-width spaces)."""
    return " ".join(text.replace("\u200b", "").split())


@dataclass
class Row:
    kind: str  # "course" | "or" | "comment" | "sum" | "header"
    codes: list[str] = field(default_factory=list)
    text: str = ""
    hours: float | None = None
    hours_text: str = ""
    indent: int = 0
    classes: list[str] = field(default_factory=list)
    footnotes: list[int] = field(default_factory=list)


def split_codes(link_text: str) -> list[str]:
    """'CSCE 222/ECEN 222' (cross-listed) -> ['CSCE 222', 'ECEN 222']."""
    return [norm(p) for p in norm(link_text).split("/") if p.strip()]


def rows(table: Tag) -> list[Row]:
    out: list[Row] = []
    for tr in table.find_all("tr"):
        classes = tr.get("class", []) or []
        if "hidden" in classes:
            continue
        if not tr.find_all(["td", "th"]):
            continue
        footnotes: list[int] = []
        for sup in tr.find_all("sup"):
            footnotes += [int(n) for n in re.findall(r"\d+", sup.get_text())]
            sup.extract()
        hours_td = tr.find("td", class_="hourscol")
        hours_text = norm(hours_td.get_text(" ")) if hours_td else ""
        m = re.search(r"\d+(?:\.\d+)?", hours_text)
        hours = float(m.group()) if m else None
        indent = 0
        indent_div = tr.find("div", class_="blockindent")
        if indent_div is not None:
            m = re.search(r"margin-left:\s*(\d+)px", indent_div.get("style", ""))
            indent = int(m.group(1)) // 20 if m else 1
        codes: list[str] = []
        for a in tr.select("a.code"):
            codes += split_codes(a.get_text(" "))
        text = norm(tr.get_text(" "))
        if {"listsum", "plangridsum", "plangridtotal"} & set(classes):
            kind = "sum"
        elif {"areaheader", "areasubheader"} & set(classes):
            kind = "header"
        elif "orclass" in classes:
            kind = "or"
        elif codes:
            kind = "course"
        else:
            kind = "comment"
        out.append(Row(kind, codes, text, hours, hours_text, indent, list(classes), footnotes))
    return out


def footnotes(container: Tag) -> dict[int, dict[str, Any]]:
    """Footnote number -> {'text': ..., 'codes': [...]} from every dl.sc_footnotes."""
    out: dict[int, dict[str, Any]] = {}
    for dl in container.find_all("dl", class_="sc_footnotes"):
        for dt in dl.find_all("dt"):
            m = re.search(r"\d+", dt.get_text())
            dd = dt.find_next_sibling("dd")
            if not m or dd is None:
                continue
            codes: list[str] = []
            for a in dd.select("a.code"):
                codes += split_codes(a.get_text(" "))
            out[int(m.group())] = {"text": norm(dd.get_text(" ")), "codes": codes}
    return out


# ---------------------------------------------------------------------------
# Slot filters
# ---------------------------------------------------------------------------


def guess_filter(label: str, notes: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    """Best-effort course filter for a placeholder label. None = needs a human.

    `notes` are the row's footnotes; a footnote that says "Select from A, B, C"
    turns the slot into a list of allowed courses.
    """
    for note in notes or []:
        if note["codes"] and re.search(r"\bselect (from|one)|choose from", note["text"], re.IGNORECASE):
            return {"codes": note["codes"]}
    core = re.search(r"\((0\d\d)\)", label)
    if core:
        return {"core": [core.group(1)]}
    if re.search(r"university core curriculum|core elective", label, re.IGNORECASE):
        return {"core": TEXAS_CORE}
    m = re.search(r"upper-division ([A-Z][A-Z ]*[A-Z])\b", label, re.IGNORECASE)
    if m and m.group(1).isupper():
        return {"subjects": [m.group(1)], "upperDivision": True}
    if re.search(r"upper-division computer science", label, re.IGNORECASE):
        return {"subjects": ["C S"], "upperDivision": True}
    if re.search(r"upper-division math(ematics)?( course)?\b", label, re.IGNORECASE):
        return {"subjects": ["M"], "upperDivision": True}
    if re.search(r"free elective", label, re.IGNORECASE):
        return {"any": True}
    return None


# ---------------------------------------------------------------------------
# Plan grid -> suggested plan
# ---------------------------------------------------------------------------


def _term_header(text: str, terms: list[dict]) -> str:
    m = re.search(r"Semester (\d)", text)
    if m:
        return {1: "Fall", 2: "Spring"}.get(int(m.group(1)), "Summer")
    for season in ("Fall", "Spring", "Summer"):
        if season.lower() in text.lower():
            return season
    return "Fall" if len(terms) % 2 == 0 else "Spring"


@dataclass
class PlanState:
    """Carries the year across several plan tables on one page (TAMU splits years)."""

    terms: list[dict] = field(default_factory=list)
    year: int = 0


def parse_plan(
    table: Tag,
    review: list[str],
    state: PlanState | None = None,
    notes: dict[int, dict[str, Any]] | None = None,
) -> list[dict]:
    state = state or PlanState()
    notes = notes or {}
    group: dict[str, Any] | None = None  # "Select one of the following" in progress

    def flush_group() -> None:
        nonlocal group
        if group is None:
            return
        g, group = group, None
        items = state.terms[-1]["items"]
        tid = state.terms[-1]["id"]
        iid = f"{tid}-{len(items) + 1}"
        courses = [c for opt in g["options"] if opt["codes"] for c in opt["codes"]]
        others = [opt["label"] for opt in g["options"] if not opt["codes"]]
        if courses and not others:
            items.append({"kind": "course", "id": iid, "code": courses[0], "alternatives": courses[1:]})
        else:
            label = "Choose one: " + " or ".join([*courses, *others])
            flt: dict[str, Any] = {"codes": courses} if courses else {"any": True}
            if any(guess_filter(o) for o in others):
                flt = guess_filter(others[0]) or flt
            items.append({"kind": "slot", "id": iid, "label": label, "credits": g["hours"], "filter": flt})

    for row in rows(table):
        if "plangridyear" in row.classes:
            flush_group()
            m = re.search(r"\d+", row.text)
            word = row.text.split()[0].lower() if row.text else ""
            state.year = int(m.group()) if m else YEAR_WORDS.get(word, state.year + 1)
            continue
        if "plangridterm" in row.classes:
            flush_group()
            season = _term_header(row.text, state.terms)
            state.terms.append(
                {
                    "id": f"y{state.year}-{season.lower()}",
                    "label": f"Year {state.year} · {season}",
                    "items": [],
                }
            )
            continue
        if row.kind == "sum" or not state.terms:
            continue

        if re.match(r"^(Select|Choose) one of the following", row.text, re.IGNORECASE):
            flush_group()
            group = {"hours": row.hours or 3, "options": []}
            continue
        if group is not None and row.indent > 0:
            label = re.sub(r"\s*\d+(\.\d+)?(-\d+)?$", "", row.text).strip()
            group["options"].append({"codes": row.codes, "label": label})
            continue
        flush_group()

        items = state.terms[-1]["items"]
        iid = f"{state.terms[-1]['id']}-{len(items) + 1}"
        if row.codes:
            item: dict[str, Any] = {"kind": "course", "id": iid, "code": row.codes[0]}
            if len(row.codes) > 1:
                item["alternatives"] = row.codes[1:]
            items.append(item)
            continue
        label = re.sub(r"\s*\d+(\.\d+)?(-\d+)?$", "", row.text).replace("Hours chosen from:", "")
        label = re.sub(r"\s*\|\s*", " ", label).strip(" |")
        if row.hours is None:
            review.append(f"plan row '{label}' in {state.terms[-1]['label']} has no hours (kept as a note)")
            continue
        flt = guess_filter(label, [notes[n] for n in row.footnotes if n in notes])
        if flt is None:
            review.append(f"plan slot '{label}' in {state.terms[-1]['label']}: filter needs review")
            flt = {"any": True}
        items.append({"kind": "slot", "id": iid, "label": label, "credits": row.hours, "filter": flt})
    flush_group()
    return state.terms
