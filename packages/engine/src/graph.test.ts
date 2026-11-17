import { describe, expect, it } from "vitest";
import { prereqEdges, routeOf } from "./graph";
import type { Course, Term } from "./schema";

const c = (code: string, prereq?: Course["prereq"]): Course => ({
  code,
  subject: code.split(" ")[0]!,
  number: code.split(" ").at(-1)!,
  title: code,
  credits: 3,
  upperDivision: false,
  core: [],
  prereq,
});
const courses = new Map(
  [
    c("A 1"),
    c("A 2", { course: "A 1" }),
    c("A 3", { all: [{ course: "A 2" }, { course: "B 1", concurrent: true }] }),
    c("B 1"),
    c("Z 9"),
  ].map((x) => [x.code, x]),
);
const terms: Term[] = [
  { id: "t1", label: "t1", items: [{ kind: "course", id: "a1", code: "A 1" }, { kind: "course", id: "z9", code: "Z 9" }] },
  { id: "t2", label: "t2", items: [{ kind: "course", id: "a2", code: "A 2" }] },
  { id: "t3", label: "t3", items: [{ kind: "course", id: "a3", code: "A 3" }, { kind: "course", id: "b1", code: "B 1" }] },
];

describe("prereq graph", () => {
  const edges = prereqEdges(terms, courses);
  it("links each course to the planned courses in its prerequisites", () => {
    expect(edges).toEqual([
      { from: "a1", to: "a2", concurrent: false },
      { from: "a2", to: "a3", concurrent: false },
      { from: "b1", to: "a3", concurrent: true },
    ]);
  });
  it("finds the whole route through a course", () => {
    const r = routeOf("a2", edges);
    expect([...r.upstream]).toEqual(["a1"]);
    expect([...r.downstream]).toEqual(["a3"]);
    expect(r.edges).toHaveLength(2);
    expect(routeOf("z9", edges).edges).toEqual([]);
  });
});
