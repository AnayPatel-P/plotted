"""Texas A&M catalog (CourseLeaf: catalog.tamu.edu).

Differences from UT that matter here:
  * Course pages put code + title in one heading ("CSCE 221 Data Structures...")
    and write prerequisites with course codes ("CSCE 120 or CSCE 121").
  * Core curriculum membership isn't on course pages; it comes from the core
    curriculum page's per-area course lists (mapped to Texas core codes).
  * Program pages have no separate requirement tables: the semester grid IS the
    degree plan, and footnotes list elective options. Requirements are derived
    from the grid (`derive_major_rules`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from bs4 import BeautifulSoup

from .courseleaf import PlanState, Rule, footnotes, norm, parse_plan, split_codes
from .fetch import fetch
from .prereq import SubjectMap, parse_prereq

BASE = "https://catalog.tamu.edu"
CORE_URL = f"{BASE}/undergraduate/general-information/university-core-curriculum/"

# Core page section headings -> Texas core component codes.
CORE_AREAS = {
    "communication": "010",
    "mathematics": "020",
    "life and physical sciences": "030",
    "language, philosophy and culture": "040",
    "creative arts": "050",
    "american history": "060",
    "government/political science": "070",
    "social and behavioral sciences": "080",
}


def list_subjects() -> list[tuple[str, str]]:
    """[(code, path)] from the course-descriptions index."""
    soup = BeautifulSoup(fetch(f"{BASE}/undergraduate/course-descriptions/"), "lxml")
    out: dict[str, str] = {}
    for a in soup.select('a[href^="/undergraduate/course-descriptions/"]'):
        m = re.search(r"\(([A-Z]{3,4})\)\s*$", norm(a.get_text(" ")))
        if m:
            out[m.group(1)] = a["href"]
    return sorted(out.items())


def core_map() -> dict[str, list[str]]:
    """Course code -> core codes, from the core curriculum page."""
    soup = BeautifulSoup(fetch(CORE_URL), "lxml")
    out: dict[str, list[str]] = {}
    for h2 in soup.find_all("h2"):
        title = norm(h2.get_text(" ")).lower()
        area = next((code for name, code in CORE_AREAS.items() if title.startswith(name)), None)
        table = h2.find_next("table")
        if area is None or table is None or table.find_previous("h2") is not h2:
            continue
        for a in table.select("a.code"):
            for code in split_codes(a.get_text(" ")):
                out.setdefault(code, [])
                if area not in out[code]:
                    out[code].append(area)
    return out


_PREREQ_END = re.compile(r"\b(Cross Listing|Equivalent|Corequisite)s?:", re.IGNORECASE)


def parse_subject_page(
    html: str, subjects: SubjectMap, core: dict[str, list[str]]
) -> tuple[list[dict], list[str]]:
    soup = BeautifulSoup(html, "lxml")
    courses: list[dict] = []
    flags: list[str] = []
    for block in soup.select("div.courseblock"):
        title_el = block.select_one(".courseblocktitle")
        if title_el is None:
            continue
        heading = norm(title_el.get_text(" "))
        m = re.match(r"^((?:[A-Z]{3,4} \d{3}[A-Z]?/?)+)\s+(.*)$", heading)
        if not m:
            continue
        codes = split_codes(m.group(1))
        title = m.group(2)
        desc = norm(block.get_text(" "))
        cm = re.search(r"Credits?\s+(\d+(?:\.\d+)?)", desc)
        credits = float(cm.group(1)) if cm else 0.0
        prereq_text = None
        pm = re.search(r"Prerequisites?:\s*(.*)$", desc)
        if pm:
            prereq_text = _PREREQ_END.split(pm.group(1))[0].strip()
        cross: list[str] = []
        xm = re.search(r"Cross Listing:\s*(.*)$", desc)
        if xm:
            cross = re.findall(r"\b[A-Z]{3,4} \d{3}[A-Z]?\b", xm.group(1))
        parsed = parse_prereq(prereq_text, subjects) if prereq_text else None
        if parsed and parsed.unparsed and any(int(c.rsplit(" ", 1)[1][:3]) < 500 for c in codes):
            flags.append(f"{'/'.join(codes)}: prereq not fully parsed: {prereq_text}")
        for code in codes:
            subject, number = code.rsplit(" ", 1)
            if int(number[:3]) >= 500:
                continue  # graduate
            course: dict[str, Any] = {
                "code": code,
                "subject": subject,
                "number": number,
                "title": title,
                "credits": int(credits) if credits.is_integer() else credits,
                "upperDivision": int(number[:3]) >= 300,
                "core": core.get(code, []),
            }
            others = [c for c in [*codes, *cross] if c != code]
            if others:
                course["crossListed"] = others
            if prereq_text:
                course["prereqText"] = prereq_text
                if parsed and parsed.prereq is not None:
                    course["prereq"] = parsed.prereq
                if parsed and parsed.unparsed:
                    course["prereqUnparsed"] = True
            courses.append(course)
    return courses, flags


def scrape_courses(subject_codes: list[str] | None = None) -> tuple[list[dict], list[str]]:
    subjects = list_subjects()
    smap = SubjectMap({code: code for code, _ in subjects})
    core = core_map()
    courses: list[dict] = []
    flags: list[str] = []
    seen: set[str] = set()
    for code, path in subjects:
        if subject_codes is not None and code not in subject_codes:
            continue
        cs, fl = parse_subject_page(fetch(BASE + path), smap, core)
        for c in cs:
            if c["code"] not in seen:  # cross-listed courses appear on both subjects' pages
                seen.add(c["code"])
                courses.append(c)
        flags += fl
    return courses, flags


# ---------------------------------------------------------------------------
# Program pages
# ---------------------------------------------------------------------------


@dataclass
class ProgramPage:
    title: str
    total_hours: float | None
    plan: list[dict]
    tables: dict[str, list[Rule]]
    review: list[str]


def derive_major_rules(plan: list[dict]) -> list[Rule]:
    """Every named course in the grid is required; elective slots whose
    footnote lists courses become credit-hour rules (hours summed per label)."""
    rules: list[Rule] = []
    electives: dict[str, Rule] = {}
    for term in plan:
        for item in term["items"]:
            if item["kind"] == "course":
                rule: Rule = {
                    "type": "course",
                    "id": f"major.{item['code'].replace(' ', '')}",
                    "code": item["code"],
                }
                if item.get("alternatives"):
                    rule["alternatives"] = item["alternatives"]
                rules.append(rule)
            elif "codes" in item["filter"] and not item["label"].lower().startswith("choose one"):
                key = item["label"]
                if key in electives:
                    electives[key]["hours"] += item["credits"]
                else:
                    electives[key] = {
                        "type": "credits",
                        "id": "major." + re.sub(r"[^a-z]+", "-", key.lower()).strip("-"),
                        "label": key,
                        "hours": item["credits"],
                        "filter": item["filter"],
                    }
            elif item["label"].lower().startswith("choose one") and "codes" in item["filter"]:
                codes = item["filter"]["codes"]
                rules.append(
                    {
                        "type": "course",
                        "id": f"major.choice-{len(rules)}",
                        "code": codes[0],
                        "alternatives": codes[1:],
                        "label": item["label"].removeprefix("Choose one: "),
                    }
                )
    return rules + list(electives.values())


def parse_program_page(html: str) -> ProgramPage:
    soup = BeautifulSoup(html, "lxml")
    title = norm(soup.find("h1", class_="page-title").get_text(" "))
    container = soup.find(id="programrequirementstextcontainer")
    review: list[str] = []
    m = re.search(r"Total Program Hours\s*(\d+)", norm(soup.get_text(" ")))
    total = float(m.group(1)) if m else None
    notes = footnotes(container)
    state = PlanState()
    for table in container.find_all("table", class_="sc_plangrid"):
        parse_plan(table, review, state, notes)
    plan = state.terms
    return ProgramPage(title, total, plan, {"Derived: Major": derive_major_rules(plan)}, review)
