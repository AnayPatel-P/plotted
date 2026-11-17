"""When courses are offered, learned from past semesters' public listings.

Sources (both official and public):
  * UT Austin: HB 2504 "Syllabi & CVs" listing (every section, by semester and
    department) — utdirect.utexas.edu/apps/student/coursedocs/nlogon/
  * Texas A&M: Registrar grade-distribution reports (every graded section, by
    semester and college) — web-as.tamu.edu/gradereports

Output per course: how many of the scraped fall / spring / summer terms had at
least one section, which terms, and a pattern with a confidence level. Courses
never seen are left out (the app shows "Offering unknown" and never warns).
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from .fetch import fetch, fetch_bytes

UT_LISTING = "https://utdirect.utexas.edu/apps/student/coursedocs/nlogon/"
TAMU_REPORT = "https://web-as.tamu.edu/gradereports/Report"

SEASONS = ("Spring", "Summer", "Fall")


@dataclass(frozen=True)
class Term:
    year: int
    season: str  # Spring | Summer | Fall

    @property
    def label(self) -> str:
        return f"{self.season} {self.year}"

    @property
    def order(self) -> int:
        return self.year * 3 + SEASONS.index(self.season)


def terms_between(first: Term, last: Term) -> list[Term]:
    out = []
    for year in range(first.year, last.year + 1):
        for season in SEASONS:
            t = Term(year, season)
            if first.order <= t.order <= last.order:
                out.append(t)
    return out


# ---------------------------------------------------------------------------
# UT Austin
# ---------------------------------------------------------------------------

UT_SEMESTER_CODE = {"Spring": "2", "Summer": "6", "Fall": "9"}


def ut_courses_offered(term: Term, department: str) -> set[str]:
    query = urlencode(
        {
            "year": term.year,
            "semester": UT_SEMESTER_CODE[term.season],
            "department": department,
            "course_type": "In Residence",
            "search": "",
        }
    )
    soup = BeautifulSoup(fetch(f"{UT_LISTING}?{query}"), "lxml")
    table = soup.find("table")
    if table is None:
        return set()
    found: set[str] = set()
    for tr in table.find_all("tr")[1:]:
        cells = [" ".join(td.get_text(" ").split()) for td in tr.find_all("td")]
        if len(cells) >= 2 and re.match(r"^[A-Z][A-Z ]* \d{3}[A-Z]?$", cells[1]):
            found.add(cells[1])
    return found


# ---------------------------------------------------------------------------
# Texas A&M
# ---------------------------------------------------------------------------

TAMU_SECTION = re.compile(r"\b([A-Z]{4})-(\d{3})-\d{3}\b")


def tamu_courses_offered(term: Term, college: str) -> set[str] | None:
    """Courses with at least one graded section; None when the report isn't published yet."""
    import pdfplumber  # heavy import, only needed here

    query = urlencode({"year": term.year, "term": term.season.upper(), "college": college})
    data = fetch_bytes(f"{TAMU_REPORT}?{query}")
    if data is None:
        return None
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages)
    return {f"{s} {n}" for s, n in TAMU_SECTION.findall(text)}


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------


def pattern_for(seen: dict[str, int], scraped: dict[str, int]) -> dict[str, Any]:
    """Classify a course from how many scraped fall / spring / summer terms it appeared in."""
    falls, springs = scraped.get("Fall", 0), scraped.get("Spring", 0)
    f, s = seen.get("Fall", 0), seen.get("Spring", 0)
    fall_rate = f / falls if falls else 0.0
    spring_rate = s / springs if springs else 0.0
    if fall_rate >= 0.5 and spring_rate >= 0.5:
        pattern = "fall-spring"
    elif fall_rate >= 0.5 and s == 0:
        pattern = "fall"
    elif spring_rate >= 0.5 and f == 0:
        pattern = "spring"
    else:
        pattern = "irregular"
    long_terms = falls + springs
    consistent = (
        (pattern == "fall-spring" and f == falls and s == springs)
        or (pattern == "fall" and f == falls)
        or (pattern == "spring" and s == springs)
    )
    confidence = "high" if long_terms >= 4 and consistent else "medium" if long_terms >= 4 else "low"
    return {"pattern": pattern, "confidence": confidence, "summer": seen.get("Summer", 0) > 0}


def build(
    school: str,
    terms: list[Term],
    groups: list[str],
    wanted_subjects: set[str],
) -> dict[str, Any]:
    """groups: UT departments or TAMU colleges to scrape each term."""
    per_course: dict[str, list[str]] = {}
    scraped_terms: list[Term] = []
    for term in terms:
        found: set[str] = set()
        published = False
        for group in groups:
            got = (
                ut_courses_offered(term, group)
                if school == "ut-austin"
                else tamu_courses_offered(term, group)
            )
            if got is None:
                continue
            published = published or bool(got)
            found |= {c for c in got if c.rsplit(" ", 1)[0] in wanted_subjects}
        if not published:
            continue  # this term's listing/report isn't available (yet)
        scraped_terms.append(term)
        for code in found:
            per_course.setdefault(code, []).append(term.label)

    scraped = {season: sum(1 for t in scraped_terms if t.season == season) for season in SEASONS}
    courses: dict[str, Any] = {}
    for code, labels in sorted(per_course.items()):
        seen = {season: sum(1 for lbl in labels if lbl.startswith(season)) for season in SEASONS}
        courses[code] = {"seen": labels, **pattern_for(seen, scraped)}
    return {
        "terms": [t.label for t in scraped_terms],
        "termCounts": scraped,
        "subjects": sorted(wanted_subjects),
        "courses": courses,
    }
