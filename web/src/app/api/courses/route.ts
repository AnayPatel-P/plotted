import { CourseFilter, courseMatches } from "@plotted/engine";
import { type NextRequest, NextResponse } from "next/server";
import { allCourses } from "@/lib/catalog";

/**
 * GET /api/courses?school=ut-austin&year=2026-28&q=data%20struct&filter={...}
 * Searches one catalog edition by code or title, optionally limited to courses
 * matching a requirement filter (used when filling a plan slot).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const school = sp.get("school") ?? "";
  const year = sp.get("year") ?? "";
  if (!/^[a-z0-9-]+$/.test(school) || !/^[0-9-]+$/.test(year)) {
    return NextResponse.json({ error: "bad school or year" }, { status: 400 });
  }
  let filter: CourseFilter | undefined;
  if (sp.get("filter")) {
    let raw: unknown;
    try {
      raw = JSON.parse(sp.get("filter")!);
    } catch {
      return NextResponse.json({ error: "bad filter" }, { status: 400 });
    }
    const parsed = CourseFilter.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "bad filter" }, { status: 400 });
    filter = parsed.data;
  }

  let courses;
  try {
    courses = await allCourses(school, year);
  } catch {
    return NextResponse.json({ error: "unknown catalog" }, { status: 404 });
  }

  // Exact lookup by code (used to show courses in shared plans).
  if (sp.get("codes") !== null) {
    const wanted = new Set((sp.get("codes") ?? "").split(",").filter(Boolean).slice(0, 200));
    const found = courses.filter((c) => wanted.has(c.code));
    return NextResponse.json({ total: found.length, courses: found });
  }

  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const credits = Number(sp.get("credits")) || null;
  // Codes named by requirements the student hasn't met yet rank first.
  const boost = new Set((sp.get("boost") ?? "").split(",").filter(Boolean).slice(0, 400));
  const qCode = q.replace(/\s+/g, "");
  const scored = [];
  for (const c of courses) {
    if (filter && !courseMatches(c, filter)) continue;
    let score = 0;
    if (q) {
      const code = c.code.replace(/\s+/g, "").toLowerCase();
      if (code === qCode) score = 100;
      else if (code.startsWith(qCode)) score = 80 - code.length;
      else if (/\d/.test(qCode) && code.includes(qCode)) score = 60 - code.length; // "373" finds C S 373
      else if (c.title.toLowerCase().startsWith(q)) score = 50;
      else if (c.title.toLowerCase().includes(q)) score = 30;
      else continue;
    }
    if (credits !== null && c.credits === credits) score += 10;
    if (boost.has(c.code)) score += 25;
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code, "en", { numeric: true }));
  return NextResponse.json({ total: scored.length, courses: scored.slice(0, 30).map((s) => s.c) });
}
