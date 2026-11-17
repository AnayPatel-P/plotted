"""plotted-scrape: build catalog JSON for the web app.

    uv run plotted-scrape                 # all UT subjects + configured programs
    uv run plotted-scrape --subjects "C S" M   # limit course subjects (fast dev loop)

Inputs:  data/<school>/<year>/overrides/*.yaml   (hand-reviewed)
Outputs: data/<school>/<year>/courses.json, programs/<id>.json, review.md
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from .fetch import fetch
from .ut_courses import scrape_courses
from .ut_program import parse_program_page

ROOT = Path(__file__).resolve().parents[3]
UT_DIR = ROOT / "data" / "ut-austin" / "2026-28"
UT_PROGRAMS = ["ut-cs-bs"]


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


def build_program(prog_id: str, out_dir: Path, scraped_at: str, known_codes: set[str]) -> list[str]:
    cfg = yaml.safe_load((out_dir / "overrides" / f"{prog_id}.yaml").read_text())
    page = parse_program_page(fetch(cfg["url"]))
    review = list(page.review)
    replaced: set[str] = set()

    areas: list[dict[str, Any]] = []
    for spec in cfg["areas"]:
        if "include" in spec:
            spec = yaml.safe_load((out_dir / "overrides" / spec["include"]).read_text())
        if "from" in spec:
            rules = page.tables.get(spec["from"])
            if rules is None:
                raise SystemExit(f"{prog_id}: table '{spec['from']}' not found on page")
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

    # Drop review notes that an override resolved.
    review = [n for n in review if not any(n.startswith(f"{rid} ") for rid in replaced)]
    if "major.r9" in replaced:
        review = [n for n in review if "nested choice" not in n]
    if any(a["id"] == "degree" for a in cfg["areas"] if "from" not in a):
        review = [n for n in review if not n.startswith("degree.")]

    plan_slots = cfg.get("planSlots", {})
    for term in page.plan:
        for item in term["items"]:
            if item["kind"] == "slot" and item["label"] in plan_slots:
                item["filter"] = plan_slots[item["label"]]
    review = [n for n in review if not any(f"plan slot '{lbl}'" in n for lbl in plan_slots)]

    # Every course the program names must exist in the catalog.
    for area in areas:
        for r in _walk(area["rule"]):
            if r.get("type") == "course":
                for code in [r["code"], *r.get("alternatives", [])]:
                    if code not in known_codes:
                        review.append(f"{area['id']}: course {code} not found in scraped catalog")

    program = {
        "id": prog_id,
        "school": "ut-austin",
        "catalogYear": "2026-28",
        "name": cfg["name"],
        "degree": cfg["degree"],
        "totalHours": page.total_hours or 120,
        "sourceUrl": cfg["url"],
        "scrapedAt": scraped_at,
        "areas": areas,
        "suggestedPlan": page.plan,
        "reviewNotes": cfg.get("notes", []) + review,
    }
    (out_dir / "programs").mkdir(exist_ok=True)
    (out_dir / "programs" / f"{prog_id}.json").write_text(json.dumps(program, indent=1) + "\n")
    return review


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--subjects", nargs="*", help="Only scrape these subject codes (dev)")
    args = ap.parse_args()

    scraped_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    courses, flags, _subjects = scrape_courses(args.subjects)
    courses.sort(key=lambda c: (c["subject"], c["number"]))
    catalog = {
        "school": "ut-austin",
        "schoolName": "The University of Texas at Austin",
        "catalogYear": "2026-28",
        "sourceUrl": "https://catalog.utexas.edu/courses/",
        "scrapedAt": scraped_at,
        "courses": courses,
    }
    UT_DIR.mkdir(parents=True, exist_ok=True)
    (UT_DIR / "courses.json").write_text(json.dumps(catalog, separators=(",", ":")) + "\n")
    print(f"courses: {len(courses)} ({sum(1 for c in courses if c.get('prereqUnparsed'))} prereqs flagged)")

    known = {c["code"] for c in courses}
    lines = ["# Review queue: UT Austin 2026-28", "", f"_Generated {scraped_at}_", ""]
    for pid in UT_PROGRAMS:
        review = build_program(pid, UT_DIR, scraped_at, known)
        print(f"{pid}: {len(review)} items need review")
        lines += [f"## {pid}", ""] + [f"- {n}" for n in review] + [""]
    lines += ["## Course prerequisites not fully parsed", ""] + [f"- {f}" for f in flags]
    (UT_DIR / "review.md").write_text("\n".join(lines) + "\n")
