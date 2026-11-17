import gzip
from pathlib import Path
from unittest.mock import patch

from plotted_scraper import offerings
from plotted_scraper.offerings import Term, pattern_for, terms_between

FIX = Path(__file__).parent / "fixtures"
SCRAPED = {"Fall": 3, "Spring": 3, "Summer": 3}


def test_terms_between_includes_summers_in_order():
    labels = [t.label for t in terms_between(Term(2023, "Fall"), Term(2024, "Fall"))]
    assert labels == ["Fall 2023", "Spring 2024", "Summer 2024", "Fall 2024"]


def test_every_long_semester_is_fall_spring_high_confidence():
    assert pattern_for({"Fall": 3, "Spring": 3, "Summer": 1}, SCRAPED) == {
        "pattern": "fall-spring",
        "confidence": "high",
        "summer": True,
    }


def test_fall_only():
    assert pattern_for({"Fall": 3}, SCRAPED)["pattern"] == "fall"
    assert pattern_for({"Fall": 3}, SCRAPED)["confidence"] == "high"


def test_spring_only_with_a_missed_year_is_medium_confidence():
    r = pattern_for({"Spring": 2}, SCRAPED)
    assert (r["pattern"], r["confidence"]) == ("spring", "medium")


def test_a_stray_section_in_the_other_season_is_irregular_not_spring_only():
    # Every spring plus one fall: not reliably either, so the app won't warn either way.
    assert pattern_for({"Spring": 3, "Fall": 1}, SCRAPED)["pattern"] == "irregular"
    assert pattern_for({"Spring": 1, "Fall": 1}, SCRAPED)["pattern"] == "irregular"


def test_too_few_terms_is_low_confidence():
    assert pattern_for({"Fall": 1}, {"Fall": 1, "Spring": 1})["confidence"] == "low"


def test_ut_listing_parser_reads_course_codes():
    html = gzip.decompress((FIX / "ut-coursedocs-cs-fall2025.html.gz").read_bytes()).decode()
    with patch.object(offerings, "fetch", return_value=html):
        codes = offerings.ut_courses_offered(Term(2025, "Fall"), "C S")
    assert {"C S 312", "C S 314", "C S 429", "C S 439", "C S 439H"} <= codes
    assert all(c.startswith("C S ") for c in codes)
