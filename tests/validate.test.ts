import { describe, expect, it } from "vitest";
import { assertValidContent, validateContent } from "../src/sim/validate";
import { emberMarches } from "../src/content";
import type { Arc, Content } from "../src/core/types";
import { makeContent, member, soloRaid } from "./fixtures";

describe("validateContent", () => {
  it("passes the shipped campaign", () => {
    expect(validateContent(emberMarches)).toEqual([]);
    expect(() => assertValidContent(emberMarches)).not.toThrow();
  });

  it("catches effects that point at content which does not exist", () => {
    const content = makeContent({
      events: [
        {
          id: "bad", title: "Bad", category: "world", weight: 1, narration: "",
          effects: [
            { kind: "resource", resource: "glitter", delta: 1 },
            { kind: "startArc", arc: "ghost" },
            { kind: "unlockRaid", raid: "ghost" },
            { kind: "scheduleEvent", event: "ghost", inDays: 1 },
            { kind: "recruit", member: "ghost" },
          ],
        },
      ],
    });
    const problems = validateContent(content);
    expect(problems).toEqual([
      'event "bad": unknown resource "glitter"',
      'event "bad": unknown arc "ghost"',
      'event "bad": unknown raid "ghost"',
      'event "bad": unknown recruit "ghost"',
      'event "bad": schedules unknown event "ghost"',
    ]);
  });

  it("resolves a forward reference to an event declared later", () => {
    const content = makeContent({
      events: [
        {
          id: "first", title: "First", category: "world", weight: 1, narration: "",
          effects: [{ kind: "scheduleEvent", event: "second", inDays: 2 }],
        },
        { id: "second", title: "Second", category: "world", weight: 0, narration: "" },
      ],
    });
    expect(validateContent(content)).toEqual([]);
  });

  it("catches duplicate event ids and negative weights", () => {
    const content = makeContent({
      events: [
        { id: "a", title: "A", category: "world", weight: 1, narration: "" },
        { id: "a", title: "A", category: "world", weight: -1, narration: "" },
      ],
    });
    expect(validateContent(content)).toEqual([
      'events: duplicate id "a"',
      'event "a": negative weight',
    ]);
  });

  it("catches broken arc wiring", () => {
    const arc: Arc = {
      id: "quest",
      title: "Quest",
      summary: "",
      start: "nowhere",
      stages: {
        a: {
          id: "a",
          text: "",
          transitions: [{ requires: { kind: "always" }, goto: "ghost" }],
          choices: [{ id: "c", text: "", goto: "ghost" }],
        },
        dead: { id: "dead", text: "" },
        mismatch: { id: "other", text: "", terminal: true },
      },
    };
    const problems = validateContent(makeContent({ arcs: { quest: arc } }));
    expect(problems).toContain('arc "quest": missing start stage "nowhere"');
    expect(problems).toContain('arc "quest" stage "a": transition to missing stage "ghost"');
    expect(problems).toContain('arc "quest" stage "a": choice "c" targets missing stage "ghost"');
    expect(problems).toContain('arc "quest" stage "dead": no transitions, no choices and not terminal');
    expect(problems).toContain('arc "quest" stage "mismatch": id mismatch ("other")');
  });

  it("catches a key that disagrees with the content's own id", () => {
    const arc: Arc = {
      id: "real", title: "", summary: "", start: "a",
      stages: { a: { id: "a", text: "", terminal: true } },
    };
    const problems = validateContent(
      makeContent({ arcs: { wrong: arc }, raids: { wrong: soloRaid() } }),
    );
    expect(problems).toContain('arcs: key "wrong" does not match arc id "real"');
    expect(problems).toContain('raids: key "wrong" does not match raid id "test-raid"');
  });

  it("catches malformed raids", () => {
    const broken = soloRaid({
      maxRounds: 0,
      phases: [{ id: "empty", name: "Empty", enemies: [] }],
      loot: [{ id: "x", name: "X", weight: 1, resource: "glitter", amount: [1, 2] }],
      onVictory: [{ kind: "unlockRaid", raid: "ghost" }],
    });
    const problems = validateContent(makeContent({ raids: { "test-raid": broken } }));
    expect(problems).toContain('raid "test-raid": maxRounds must be positive');
    expect(problems).toContain('raid "test-raid" phase "empty": no enemies');
    expect(problems).toContain('raid "test-raid" loot "x": unknown resource "glitter"');
    expect(problems).toContain('raid "test-raid" onVictory: unknown raid "ghost"');
  });

  it("catches members with unknown abilities or no health", () => {
    const content = makeContent({
      startingParty: [member({ id: "a", abilities: ["ghost"] })],
      reserves: [member({ id: "b", maxHp: 0 })],
    });
    const problems = validateContent(content);
    expect(problems).toContain('startingParty: "a" uses unknown ability "ghost"');
    expect(problems).toContain('reserves: "b" has non-positive maxHp');
  });

  it("throws a single report listing every problem", () => {
    const content: Content = makeContent({
      startingParty: [member({ id: "a", abilities: ["ghost"] })],
    });
    expect(() => assertValidContent(content)).toThrow(/Invalid content:/);
    expect(() => assertValidContent(content)).toThrow(/unknown ability "ghost"/);
  });
});
