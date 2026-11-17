"""plotted-scrape: build catalog JSON for the web app.

    uv run plotted-scrape                          # every school + its configured programs
    uv run plotted-scrape --school tamu            # one school
    uv run plotted-scrape --school ut-austin --subjects "C S" M   # dev loop: a few subjects

Inputs:  data/<school>/<year>/overrides/*.yaml   (hand-reviewed)
Outputs: data/<school>/<year>/courses/<SUBJECT>.json, courses/index.json,
         programs/<id>.json, review.md
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from . import offerings, tamu, ut_courses, ut_program
from .fetch import fetch

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "data"


@dataclass
class School:
    id: str
    name: str
    catalog_year: str
    courses_url: str
    scrape_courses: Callable[[list[str] | None], tuple[list[dict], list[str]]]
    parse_program: Callable[[str], Any]
    programs: list[str]
    offerings_source: str = ""
    offerings_groups: Callable[[set[str]], list[str]] | None = None

    @property
    def dir(self) -> Path:
        return DATA / self.id / self.catalog_year


SCHOOLS = {
    "ut-austin": School(
        id="ut-austin",
        name="The University of Texas at Austin",
        catalog_year="2026-28",
        courses_url="https://catalog.utexas.edu/courses/",
        scrape_courses=lambda subjects: ut_courses.scrape_courses(subjects)[:2],
        parse_program=ut_program.parse_program_page,
        programs=["ut-cs-bs", "ut-math-bs"],
        offerings_source=offerings.UT_LISTING,
        offerings_groups=lambda subjects: sorted(subjects),  # one listing request per department
    ),
    "tamu": School(
        id="tamu",
        name="Texas A&M University",
        catalog_year="2026-27",
        courses_url="https://catalog.tamu.edu/undergraduate/course-descriptions/",
        scrape_courses=tamu.scrape_courses,
        parse_program=tamu.parse_program_page,
        programs=["tamu-daen-bs"],
        offerings_source="https://web-as.tamu.edu/gradereports",
        offerings_groups=lambda subjects: [
            "EN",
            "AT",
        ],  # Engineering; Arts & Sciences (math, science, liberal arts)
    ),
}


def subject_file(subject: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", subject) + ".json"


def _replace_rules(rules: list[dict], replace: dict[str, dict]) -> list[dict]:
    out = []
    for r in rules:
        if r.get("id") in replace:
            out.append(replace[r["id"]])
            continue
        if "rules" in r:
            r = {**r, "rules": _replace_rules(r["rules"], replace)}
        out.append(r)
    return out


def _walk(rule: dict):
    yield rule
    for child in rule.get("rules", []):
        yield from _walk(child)


def _prefix(rules: list[dict]) -> str | None:
    return rules[0]["id"].split(".")[0] if rules else None


def build_program(school: School, prog_id: str, today: str, known: set[str]) -> list[str]:
    out_dir = school.dir
    cfg = yaml.safe_load((out_dir / "overrides" / f"{prog_id}.yaml").read_text())
    page = school.parse_program(fetch(cfg["url"]))
    review = list(page.review)
    replaced: set[str] = set()
    used_tables: set[str] = set()

    areas: list[dict[str, Any]] = []
    for spec in cfg["areas"]:
        if "include" in spec:
            spec = yaml.safe_load((out_dir / "overrides" / spec["include"]).read_text())
        if "from" in spec:
            rules = page.tables.get(spec["from"])
            if rules is None:
                raise SystemExit(f"{prog_id}: table '{spec['from']}' not found (have {list(page.tables)})")
            used_tables.add(spec["from"])
            replace = spec.get("replace", {})
            replaced |= set(replace)
            rule = {
                "type": "allOf",
                "id": spec["id"],
                "label": spec["label"],
                "rules": _replace_rules(rules, replace),
            }
        else:
            rule = spec["rule"]
        areas.append(
            {"id": spec["id"], "label": spec["label"], "exclusive": spec.get("exclusive", True), "rule": rule}
        )

    # Drop review notes resolved by an override, or about tables this program doesn't use.
    unused = {_prefix(r) for name, r in page.tables.items() if name not in used_tables} - {None}
    review = [
        n
        for n in review
        if not any(n.startswith((f"{rid} ", f"{rid}:")) for rid in replaced)
        and not any(n.startswith((f"{p}.", f"{p}:")) for p in unused)
    ]

    # Plan fixes: replace items by id, then map slot labels (substring match) to filters.
    plan = page.plan
    plan_replace = cfg.get("planReplace", {})
    for term in plan:
        term["items"] = [
            {**plan_replace[i["id"]], "id": i["id"]} if i["id"] in plan_replace else i for i in term["items"]
        ]
    plan_slots: dict[str, Any] = cfg.get("planSlots", {})
    for term in plan:
        for item in term["items"]:
            for key, flt in plan_slots.items():
                if item["kind"] == "slot" and key in item["label"]:
                    item["filter"] = flt
    review = [n for n in review if not any(n.startswith("plan slot '") and key in n for key in plan_slots)]
    review = [
        n
        for n in review
        if not any(n.startswith("plan row '") and key in n for key in cfg.get("planNotes", []))
    ]

    # Checks: every course the program names exists; no course appears twice in the plan.
    for area in areas:
        for r in _walk(area["rule"]):
            if r.get("type") == "course":
                for code in [r["code"], *r.get("alternatives", [])]:
                    if code not in known:
                        review.append(f"{area['id']}: course {code} not found in scraped catalog")
    for term in plan:
        for item in term["items"]:
            if item["kind"] == "course" and item["code"] not in known:
                review.append(f"plan: course {item['code']} ({term['label']}) not found in scraped catalog")
    known_missing = set(cfg.get("knownMissing", []))
    review = [n for n in review if not any(f"course {code} " in n for code in known_missing)]
    counts = Counter(i["code"] for t in plan for i in t["items"] if i["kind"] == "course")
    review += [f"plan: {code} appears {n} times in the suggested plan" for code, n in counts.items() if n > 1]

    program = {
        "id": prog_id,
        "school": school.id,
        "catalogYear": school.catalog_year,
        "name": cfg["name"],
        "degree": cfg["degree"],
        "totalHours": page.total_hours or 120,
        "sourceUrl": cfg["url"],
        "scrapedAt": today,
        "areas": areas,
        "suggestedPlan": plan,
        "reviewNotes": cfg.get("notes", []) + review,
    }
    (out_dir / "programs").mkdir(exist_ok=True)
    (out_dir / "programs" / f"{prog_id}.json").write_text(
        json.dumps(program, indent=1, ensure_ascii=False) + "\n"
    )
    return review


def write_courses(school: School, courses: list[dict], today: str) -> None:
    """One JSON file per subject plus an index, so the app loads only what it needs."""
    cdir = school.dir / "courses"
    cdir.mkdir(parents=True, exist_ok=True)
    for old in cdir.glob("*.json"):
        old.unlink()
    by_subject: dict[str, list[dict]] = {}
    for c in sorted(courses, key=lambda c: (c["subject"], c["number"])):
        by_subject.setdefault(c["subject"], []).append(c)
    for subject, cs in by_subject.items():
        (cdir / subject_file(subject)).write_text(
            json.dumps(cs, separators=(",", ":"), ensure_ascii=False) + "\n"
        )
    index = {
        "school": school.id,
        "schoolName": school.name,
        "catalogYear": school.catalog_year,
        "sourceUrl": school.courses_url,
        "scrapedAt": today,
        "subjects": [{"code": s, "file": subject_file(s), "count": len(cs)} for s, cs in by_subject.items()],
    }
    (cdir / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    legacy = school.dir / "courses.json"
    if legacy.exists():
        legacy.unlink()


OFFERINGS_WINDOW = (offerings.Term(2023, "Fall"), offerings.Term(2026, "Fall"))


def program_codes(school: School, courses: dict[str, dict]) -> set[str]:
    """Course codes the school's programs name (rules, plans) plus their prerequisites."""
    codes: set[str] = set()
    for f in (school.dir / "programs").glob("*.json"):
        text = f.read_text()
        codes |= set(re.findall(r'"(?:code|alternatives)": "([^"]+)"', text))
        for m in re.finditer(r'"codes": \[([^\]]*)\]', text):
            codes |= set(re.findall(r'"([^"]+)"', m.group(1)))
        for alts in re.finditer(r'"alternatives": \[([^\]]*)\]', text):
            codes |= set(re.findall(r'"([^"]+)"', alts.group(1)))

    def prereqs(p: Any) -> list[str]:
        if not isinstance(p, dict):
            return []
        if "course" in p:
            return [p["course"]]
        return [c for k in ("all", "any") for x in p.get(k, []) for c in prereqs(x)]

    for code in list(codes):
        codes |= set(prereqs(courses.get(code, {}).get("prereq")))
    return codes


def run_offerings(school: School, courses: list[dict]) -> None:
    if not school.offerings_groups:
        return
    by_code = {c["code"]: c for c in courses}
    named = program_codes(school, by_code)
    subjects = {c.rsplit(" ", 1)[0] for c in named}
    terms = offerings.terms_between(*OFFERINGS_WINDOW)
    result = offerings.build(school.id, terms, school.offerings_groups(subjects), subjects)
    covered = sum(1 for c in named if c in result["courses"])
    result = {
        "school": school.id,
        "source": school.offerings_source,
        "scrapedAt": datetime.now(UTC).strftime("%Y-%m-%d"),
        "coverage": {"named": len(named), "seen": covered},
        **result,
    }
    (school.dir / "offerings.json").write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    print(
        f"  offerings: {len(result['courses'])} courses over {len(result['terms'])} terms; "
        f"{covered}/{len(named)} program courses seen"
    )


def run_school(school: School, subjects: list[str] | None, with_offerings: bool = True) -> None:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    courses, flags = school.scrape_courses(subjects)
    write_courses(school, courses, today)
    print(f"{school.id}: {len(courses)} courses ({len(flags)} prereq texts flagged)")

    known = {c["code"] for c in courses}
    lines = [f"# Review queue: {school.name} {school.catalog_year}", ""]
    for pid in school.programs:
        review = build_program(school, pid, today, known)
        print(f"  {pid}: {len(review)} items need review")
        lines += [f"## {pid}", ""] + ([f"- {n}" for n in review] or ["Nothing to review."]) + [""]
    lines += ["## Course prerequisites not fully parsed", ""] + [f"- {f}" for f in sorted(flags)]
    (school.dir / "review.md").write_text("\n".join(lines) + "\n")
    if with_offerings and subjects is None:
        run_offerings(school, courses)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--school", choices=sorted(SCHOOLS), help="Only this school")
    ap.add_argument("--subjects", nargs="*", help="Only scrape these subject codes (dev)")
    ap.add_argument("--skip-offerings", action="store_true", help="Don't rebuild offerings.json")
    args = ap.parse_args()
    for sid, school in SCHOOLS.items():
        if args.school in (None, sid):
            run_school(school, args.subjects, with_offerings=not args.skip_offerings)
