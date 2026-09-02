import { describe, expect, it } from "vitest";
import { compare, describeCondition, evaluate } from "../src/core/conditions";
import type { Condition } from "../src/core/types";
import { harness, member } from "./fixtures";

describe("compare", () => {
  it("implements every operator", () => {
    expect(compare(1, "<", 2)).toBe(true);
    expect(compare(2, "<=", 2)).toBe(true);
    expect(compare(2, "==", 2)).toBe(true);
    expect(compare(2, "!=", 2)).toBe(false);
    expect(compare(3, ">=", 2)).toBe(true);
    expect(compare(1, ">", 2)).toBe(false);
  });
});

describe("evaluate", () => {
  it("treats a missing condition as satisfied", () => {
    const { state } = harness();
    expect(evaluate(undefined, state)).toBe(true);
    expect(evaluate({ kind: "always" }, state)).toBe(true);
    expect(evaluate({ kind: "never" }, state)).toBe(false);
  });

  it("defaults flag checks to 'is set' and honours an explicit false", () => {
    const { state } = harness();
    expect(evaluate({ kind: "flag", flag: "seen" }, state)).toBe(false);
    expect(evaluate({ kind: "flag", flag: "seen", value: false }, state)).toBe(true);
    state.flags["seen"] = true;
    expect(evaluate({ kind: "flag", flag: "seen" }, state)).toBe(true);
    expect(evaluate({ kind: "flag", flag: "seen", value: false }, state)).toBe(false);
  });

  it("compares resources, treating unknown ones as zero", () => {
    const { state } = harness();
    expect(evaluate({ kind: "resource", resource: "gold", op: ">=", value: 100 }, state)).toBe(true);
    expect(evaluate({ kind: "resource", resource: "gold", op: ">", value: 100 }, state)).toBe(false);
    expect(evaluate({ kind: "resource", resource: "nope", op: "==", value: 0 }, state)).toBe(true);
  });

  it("reads the day and the living party", () => {
    const { state } = harness({
      startingParty: [member({ id: "a", role: "vanguard" }), member({ id: "b", role: "ranger" })],
    });
    state.day = 7;
    expect(evaluate({ kind: "day", op: ">=", value: 7 }, state)).toBe(true);
    expect(evaluate({ kind: "partySize", op: "==", value: 2 }, state)).toBe(true);
    expect(evaluate({ kind: "partyHasRole", role: "vanguard" }, state)).toBe(true);
    expect(evaluate({ kind: "partyHasRole", role: "arcanist" }, state)).toBe(false);
    expect(evaluate({ kind: "partyPower", op: ">", value: 0 }, state)).toBe(true);
  });

  it("ignores the dead when counting the party", () => {
    const { state } = harness({
      startingParty: [member({ id: "a", role: "vanguard" }), member({ id: "b" })],
    });
    state.party[0]!.hp = 0;
    expect(evaluate({ kind: "partySize", op: "==", value: 1 }, state)).toBe(true);
    expect(evaluate({ kind: "partyHasRole", role: "vanguard" }, state)).toBe(false);
  });

  it("distinguishes an arc's current stage from a completed arc", () => {
    const { state } = harness();
    state.arcs["quest"] = {
      arcId: "quest", stage: "middle", startedDay: 1, completed: false, history: [],
    };
    expect(evaluate({ kind: "arcStarted", arc: "quest" }, state)).toBe(true);
    expect(evaluate({ kind: "arcStage", arc: "quest", stage: "middle" }, state)).toBe(true);
    expect(evaluate({ kind: "arcCompleted", arc: "quest" }, state)).toBe(false);

    state.arcs["quest"]!.completed = true;
    state.arcs["quest"]!.outcome = "won";
    // A completed arc no longer counts as sitting on a stage.
    expect(evaluate({ kind: "arcStage", arc: "quest", stage: "middle" }, state)).toBe(false);
    expect(evaluate({ kind: "arcCompleted", arc: "quest" }, state)).toBe(true);
    expect(evaluate({ kind: "arcCompleted", arc: "quest", outcome: "won" }, state)).toBe(true);
    expect(evaluate({ kind: "arcCompleted", arc: "quest", outcome: "lost" }, state)).toBe(false);
  });

  it("counts event firings, defaulting to 'at least once'", () => {
    const { state } = harness();
    expect(evaluate({ kind: "eventFired", event: "scout" }, state)).toBe(false);
    state.events["scout"] = { count: 2, lastDay: 4 };
    expect(evaluate({ kind: "eventFired", event: "scout" }, state)).toBe(true);
    expect(evaluate({ kind: "eventFired", event: "scout", op: ">=", value: 2 }, state)).toBe(true);
    expect(evaluate({ kind: "eventFired", event: "scout", op: ">", value: 2 }, state)).toBe(false);
  });

  it("reads raid unlock and clear status", () => {
    const { state } = harness();
    expect(evaluate({ kind: "raidUnlocked", raid: "keep" }, state)).toBe(false);
    state.unlockedRaids.push("keep");
    expect(evaluate({ kind: "raidUnlocked", raid: "keep" }, state)).toBe(true);
    expect(evaluate({ kind: "raidCleared", raid: "keep" }, state)).toBe(false);
    state.clearedRaids.push("keep");
    expect(evaluate({ kind: "raidCleared", raid: "keep" }, state)).toBe(true);
  });

  it("composes with not/all/any, with empty sets behaving as identities", () => {
    const { state } = harness();
    const yes: Condition = { kind: "always" };
    const no: Condition = { kind: "never" };
    expect(evaluate({ kind: "not", of: no }, state)).toBe(true);
    expect(evaluate({ kind: "all", of: [yes, yes] }, state)).toBe(true);
    expect(evaluate({ kind: "all", of: [yes, no] }, state)).toBe(false);
    expect(evaluate({ kind: "any", of: [no, yes] }, state)).toBe(true);
    expect(evaluate({ kind: "any", of: [no, no] }, state)).toBe(false);
    expect(evaluate({ kind: "all", of: [] }, state)).toBe(true);
    expect(evaluate({ kind: "any", of: [] }, state)).toBe(false);
  });

  it("is pure: evaluating never changes state", () => {
    const { state } = harness();
    const before = JSON.stringify(state);
    evaluate({ kind: "all", of: [{ kind: "flag", flag: "x" }, { kind: "day", op: ">", value: 0 }] }, state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("describeCondition", () => {
  it("renders conditions in readable prose", () => {
    expect(describeCondition(undefined)).toBe("no requirement");
    expect(describeCondition({ kind: "resource", resource: "gold", op: ">=", value: 10 }))
      .toBe("gold >= 10");
    expect(describeCondition({ kind: "not", of: { kind: "flag", flag: "x" } }))
      .toBe("not (x is true)");
    expect(
      describeCondition({
        kind: "all",
        of: [{ kind: "day", op: ">", value: 2 }, { kind: "raidCleared", raid: "keep" }],
      }),
    ).toBe('(day > 2 and raid "keep" cleared)');
    expect(describeCondition({ kind: "any", of: [] })).toBe("never");
    expect(describeCondition({ kind: "all", of: [] })).toBe("always");
  });
});
