"""Parse catalog prerequisite prose into a Prereq expression.

Output shape matches packages/engine/src/schema.ts:
    {"course": "C S 429", "concurrent": False} | {"all": [...]} | {"any": [...]} | {"text": "..."}

UT writes prerequisites with full subject names ("Computer Science 429 or 429H;
Mathematics 362K or Statistics and Data Sciences 321"). The parser:
  1. splits into clauses on ";" and on " and " between course groups (AND),
  2. splits each clause on "," / " or " (OR, when the clause says "or"),
  3. carries the subject forward ("Computer Science 429 or 429H" -> C S 429H),
  4. marks "credit ... or registration for" clauses as concurrent-OK,
  5. keeps anything it can't read as a {"text": ...} node and reports it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

Prereq = dict[str, Any]

COURSE_NUM = r"\d{3}[A-Z]?"
_NUM_RE = re.compile(rf"^{COURSE_NUM}$")
_GRADE_RE = re.compile(r"\bwith (a )?grades? of at least [A-F][+-]?( in each)?\b", re.IGNORECASE)
_CONCURRENT_RE = re.compile(r"\b(or|and) registration for\b|\bconcurrent", re.IGNORECASE)
# Phrases that are not course requirements but are common; kept as text notes.
_TEXT_ONLY_RE = re.compile(
    r"consent|admission|standing|approval|restricted|major|instructor|placement|score|"
    r"enrollment in|declared|permission|appropriate|equivalent|exam|semester (credit )?hours|"
    r"\bhours of\b|vary|varies|knowledge|topic|experience|proficiency|credit for|grade point|"
    r"program|certificate|portfolio|audition|students",
    re.IGNORECASE,
)


@dataclass
class ParseResult:
    prereq: Prereq | None
    unparsed: bool
    notes: list[str] = field(default_factory=list)


class SubjectMap:
    """Maps full subject names ("Computer Science") to codes ("C S")."""

    def __init__(self, names_to_codes: dict[str, str]):
        self.names = dict(names_to_codes)
        # Longest names first so "Statistics and Data Sciences" beats "Statistics".
        alts = sorted(self.names, key=len, reverse=True)
        self.pattern = re.compile(r"\b(" + "|".join(re.escape(a) for a in alts) + r")\b") if alts else None

    def tokenize(self, text: str) -> list[tuple[str, str]]:
        """Return a token list of ("subj", code) / ("num", "429H") / ("word", w) / ("sep", s)."""
        tokens: list[tuple[str, str]] = []
        pos = 0
        if self.pattern is None:
            return tokens
        for m in self.pattern.finditer(text):
            tokens += _tokenize_plain(text[pos : m.start()])
            tokens.append(("subj", self.names[m.group(1)]))
            pos = m.end()
        tokens += _tokenize_plain(text[pos:])
        return tokens


def _tokenize_plain(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for tok in re.findall(r"\d{3}[A-Z]?\b|,|;|[A-Za-z][A-Za-z'-]*", text):
        if _NUM_RE.match(tok):
            out.append(("num", tok))
        elif tok in {",", ";"}:
            out.append(("sep", tok))
        else:
            out.append(("word", tok.lower()))
    return out


def _courses_in(tokens: list[tuple[str, str]]) -> list[str]:
    subj: str | None = None
    courses: list[str] = []
    for kind, val in tokens:
        if kind == "subj":
            subj = val
        elif kind == "num" and subj:
            courses.append(f"{subj} {val}")
    return courses


def _simplify(node: Prereq) -> Prereq:
    for key in ("all", "any"):
        if key in node:
            kids = [_simplify(k) for k in node[key]]
            flat: list[Prereq] = []
            for k in kids:
                flat.extend(k.get(key, [k]))
            # dedupe while keeping order
            seen: list[Prereq] = []
            for k in flat:
                if k not in seen:
                    seen.append(k)
            return seen[0] if len(seen) == 1 else {key: seen}
    return node


def parse_prereq(text: str, subjects: SubjectMap) -> ParseResult:
    raw = " ".join(text.split())
    if not raw:
        return ParseResult(None, False)

    notes: list[str] = []
    clauses_out: list[Prereq] = []
    unparsed = False

    # Split top-level clauses on ";" (UT uses ";" for AND between groups).
    for clause in [c.strip() for c in raw.split(";") if c.strip()]:
        concurrent = bool(_CONCURRENT_RE.search(clause))
        cleaned = _GRADE_RE.sub("", clause)
        tokens = subjects.tokenize(cleaned)
        courses = _courses_in(tokens)

        if not courses:
            notes.append(clause.rstrip("."))
            clauses_out.append({"text": clause.rstrip(".")})
            if not _TEXT_ONLY_RE.search(clause):
                unparsed = True
            continue

        if _TEXT_ONLY_RE.search(clause) and not concurrent:
            # e.g. "Computer Science 429, or consent of instructor" -> course OR text
            alt_text = clause.rstrip(".")
            group = _group_courses(tokens, concurrent)
            clauses_out.append({"any": [group, {"text": alt_text}]})
            notes.append(alt_text)
            continue

        clauses_out.append(_group_courses(tokens, concurrent))

    if not clauses_out:
        return ParseResult(None, False)
    return ParseResult(_simplify({"all": clauses_out}), unparsed, notes)


def _group_courses(tokens: list[tuple[str, str]], concurrent: bool) -> Prereq:
    """Within a clause: split on 'and' into AND-groups, each group is an OR-list.

    "Computer Science 429 or 429H and Mathematics 340L" -> all[any[429,429H], 340L]
    "Mathematics 340L, 341, or Statistics and Data Sciences 329C" -> any[...]
    A comma list joined by "and" ("A, B, and C") is AND.
    """
    words = [v for k, v in tokens if k == "word"]
    has_or = "or" in words
    groups: list[list[tuple[str, str]]] = [[]]
    subj_carry: tuple[str, str] | None = None
    for kind, val in tokens:
        if kind == "subj":
            subj_carry = (kind, val)
        if kind == "word" and val == "and":
            groups.append([subj_carry] if subj_carry else [])
            continue
        if kind == "sep" and val == "," and not has_or:
            # "A, B, and C" -> each comma is an AND boundary
            groups.append([subj_carry] if subj_carry else [])
            continue
        groups[-1].append((kind, val))

    def leaf(code: str) -> Prereq:
        return {"course": code, "concurrent": True} if concurrent else {"course": code}

    and_parts: list[Prereq] = []
    for g in groups:
        cs = _courses_in(g)
        if not cs:
            continue
        and_parts.append({"any": [leaf(c) for c in cs]})
    return _simplify({"all": and_parts})
