"""UT Austin course listings (CourseLeaf: catalog.utexas.edu/courses/<subject>/)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from bs4 import BeautifulSoup

from .fetch import fetch
from .prereq import SubjectMap, parse_prereq

BASE = "https://catalog.utexas.edu"


@dataclass
class Subject:
    code: str  # "C S"
    name: str  # "Computer Science"
    path: str  # "/courses/c_s/"


def list_subjects() -> list[Subject]:
    soup = BeautifulSoup(fetch(f"{BASE}/courses/"), "lxml")
    out: dict[str, Subject] = {}
    for a in soup.select('a[href^="/courses/"]'):
        m = re.match(r"^(.*)\s+\(([^)]+)\)$", a.get_text(" ", strip=True))
        if m:
            out[m.group(2)] = Subject(code=m.group(2), name=m.group(1), path=a["href"])
    return sorted(out.values(), key=lambda s: s.code)


def _text(block: Any, cls: str) -> str | None:
    el = block.select_one(f".detail-{cls}")
    if el is None:
        return None
    strong = el.find("strong")
    if strong:
        strong.extract()
    return " ".join(el.get_text(" ", strip=True).split())


def parse_subject_page(html: str, subjects: SubjectMap) -> tuple[list[dict], list[str]]:
    """Return (courses, flagged notes) for one subject page."""
    soup = BeautifulSoup(html, "lxml")
    courses: list[dict] = []
    flags: list[str] = []
    for block in soup.select("div.courseblock"):
        code = _text(block, "ut_code")
        title = _text(block, "title")
        if not code or not title:
            continue
        code = " ".join(code.split())
        # "CH 301, 401" = one course offered at 3 or 4 hours; "AAS 310.1" = a topic.
        m = re.match(r"^(.*?)\s+(\d{3}[A-Z]?(?:\.\d+)?(?:,\s*\d{3}[A-Z]?(?:\.\d+)?)*)$", code)
        if not m:
            continue
        subject = m.group(1)
        numbers = [n.strip() for n in m.group(2).split(",")]
        level = (_text(block, "acad_level") or "").lower()
        core_raw = _text(block, "utexas_core") or ""
        prereq_text = _text(block, "prereq")
        parsed = parse_prereq(prereq_text, subjects) if prereq_text else None
        undergrad = [n for n in numbers if "." not in n and int(n[1:3]) < 80]
        if parsed and parsed.unparsed and undergrad:
            flags.append(f"{code}: prereq not fully parsed: {prereq_text}")
        for number in numbers:
            if "." in number:
                continue  # topic variants; the base course is listed separately
            if int(number[1:3]) >= 80:
                continue  # graduate course (UT: last two digits 80-99)
            course: dict[str, Any] = {
                "code": f"{subject} {number}",
                "subject": subject,
                "number": number,
                "title": title,
                # UT: the first digit of the number is the credit hours.
                "credits": int(number[0]),
                "upperDivision": "upper" in level,
                "core": re.findall(r"\b0\d\d\b", core_raw),
            }
            if prereq_text:
                course["prereqText"] = prereq_text
                if parsed and parsed.prereq is not None:
                    course["prereq"] = parsed.prereq
                if parsed and parsed.unparsed:
                    course["prereqUnparsed"] = True
            courses.append(course)
    return courses, flags


def scrape_courses(subject_codes: list[str] | None = None) -> tuple[list[dict], list[str], list[Subject]]:
    """Scrape all (or the given) subjects. Returns (courses, flags, subjects)."""
    subjects = list_subjects()
    smap = SubjectMap({s.name: s.code for s in subjects})
    wanted = [s for s in subjects if subject_codes is None or s.code in subject_codes]
    all_courses: list[dict] = []
    flags: list[str] = []
    for s in wanted:
        courses, f = parse_subject_page(fetch(BASE + s.path), smap)
        all_courses += courses
        flags += f
    return all_courses, flags, subjects
