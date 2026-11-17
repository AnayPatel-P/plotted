from plotted_scraper.prereq import SubjectMap, parse_prereq

SUBJECTS = SubjectMap(
    {
        "Computer Science": "C S",
        "Mathematics": "M",
        "Statistics and Data Sciences": "SDS",
        "Statistics": "STA",
        "Physics": "PHY",
    }
)


def p(text):
    return parse_prereq(text, SUBJECTS)


def test_simple_or_with_subject_carry():
    r = p("Computer Science 429, or 429H with a grade of at least C-.")
    assert r.prereq == {"any": [{"course": "C S 429"}, {"course": "C S 429H"}]}
    assert not r.unparsed


def test_ut_cs_331_three_clauses_with_concurrent():
    r = p(
        "The following coursework with a grade of at least C-: Computer Science 429 or 429H; "
        "Mathematics 362K or Statistics and Data Sciences 321; and credit with a grade of at least C- "
        "or registration for: Mathematics 340L, 341, or Statistics and Data Sciences 329C."
    )
    assert r.prereq == {
        "all": [
            {"any": [{"course": "C S 429"}, {"course": "C S 429H"}]},
            {"any": [{"course": "M 362K"}, {"course": "SDS 321"}]},
            {
                "any": [
                    {"course": "M 340L", "concurrent": True},
                    {"course": "M 341", "concurrent": True},
                    {"course": "SDS 329C", "concurrent": True},
                ]
            },
        ]
    }


def test_subject_name_containing_and_is_not_split():
    r = p("Statistics and Data Sciences 321.")
    assert r.prereq == {"course": "SDS 321"}


def test_and_list():
    r = p("Physics 303K, 105M, and 303L.")
    assert r.prereq == {"all": [{"course": "PHY 303K"}, {"course": "PHY 105M"}, {"course": "PHY 303L"}]}


def test_and_between_or_groups():
    r = p("Computer Science 314 or 314H and Mathematics 408C.")
    assert r.prereq == {
        "all": [{"any": [{"course": "C S 314"}, {"course": "C S 314H"}]}, {"course": "M 408C"}]
    }


def test_consent_only_is_text_not_unparsed():
    r = p("Consent of instructor.")
    assert r.prereq == {"text": "Consent of instructor"}
    assert not r.unparsed


def test_course_or_consent():
    r = p("Computer Science 439 or consent of instructor.")
    assert r.prereq == {
        "any": [{"course": "C S 439"}, {"text": "Computer Science 439 or consent of instructor"}]
    }


def test_unknown_prose_is_flagged():
    r = p("Two semesters of college-level coursework in a related field.")
    assert r.unparsed


def test_registration_in_is_concurrent():
    r = p(
        "Physics 301 and 101L with a grade of at least C- in each; credit with a grade of at least C- "
        "or registration in Mathematics 408D or 408M, and Physics 116L."
    )
    assert r.prereq == {
        "all": [
            {"course": "PHY 301"},
            {"course": "PHY 101L"},
            {"any": [{"course": "M 408D", "concurrent": True}, {"course": "M 408M", "concurrent": True}]},
            {"course": "PHY 116L", "concurrent": True},
        ]
    }
