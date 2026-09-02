import { describe, expect, it } from "vitest";
import { applyEffects } from "../src/core/effects";
import type { Arc } from "../src/core/types";
import { harness, member, messages, soloRaid } from "./fixtures";

const arc: Arc = {
  id: "quest",
  title: "Quest",
  summary: "",
  start: "one",
  stages: {
    one: { id: "one", text: "one", transitions: [{ requires: { kind: "never" }, goto: "two" }] },
    two: { id: "two", text: "two", terminal: true, outcome: "done" },
  },
};

describe("resource effects", () => {
  it("clamps to the declared bounds and logs the delta actually applied", () => {
    const h = harness();
    applyEffects([{ kind: "resource", resource: "gold", delta: 1000 }], h.ctx);
    expect(h.state.resources["gold"]).toBe(500);
    expect(messages(h.log)).toContain("gold +400");

    applyEffects([{ kind: "resource", resource: "gold", delta: -9999 }], h.ctx);
    expect(h.state.resources["gold"]).toBe(0);
    expect(messages(h.log)).toContain("gold -500");
  });

  it("stays silent when a clamp makes the change a no-op", () => {
    const h = harness();
    h.state.resources["gold"] = 500;
    applyEffects([{ kind: "resource", resource: "gold", delta: 50 }], h.ctx);
    expect(h.log.length).toBe(0);
  });
});

describe("flag and arc effects", () => {
  it("sets flags, defaulting to true", () => {
    const h = harness();
    applyEffects([{ kind: "setFlag", flag: "a" }, { kind: "setFlag", flag: "b", value: false }], h.ctx);
    expect(h.state.flags).toEqual({ a: true, b: false });
  });

  it("starts an arc at its declared start stage, and never restarts one", () => {
    const h = harness({ arcs: { quest: arc } });
    h.state.day = 3;
    applyEffects([{ kind: "startArc", arc: "quest" }], h.ctx);
    expect(h.state.arcs["quest"]).toMatchObject({ stage: "one", startedDay: 3, completed: false });

    h.state.arcs["quest"]!.stage = "two";
    applyEffects([{ kind: "startArc", arc: "quest" }], h.ctx);
    expect(h.state.arcs["quest"]!.stage).toBe("two");
  });

  it("rejects references to content that does not exist", () => {
    const h = harness({ arcs: { quest: arc } });
    expect(() => applyEffects([{ kind: "startArc", arc: "ghost" }], h.ctx)).toThrow(/unknown arc/);
    expect(() => applyEffects([{ kind: "advanceArc", arc: "quest", stage: "ghost" }], h.ctx))
      .toThrow(/no stage/);
    expect(() => applyEffects([{ kind: "unlockRaid", raid: "ghost" }], h.ctx)).toThrow(/unknown raid/);
  });

  it("advances and completes only arcs that are running", () => {
    const h = harness({ arcs: { quest: arc } });
    applyEffects([{ kind: "advanceArc", arc: "quest", stage: "two" }], h.ctx);
    expect(h.state.arcs["quest"]).toBeUndefined();

    applyEffects(
      [
        { kind: "startArc", arc: "quest" },
        { kind: "advanceArc", arc: "quest", stage: "two" },
        { kind: "completeArc", arc: "quest", outcome: "done" },
      ],
      h.ctx,
    );
    expect(h.state.arcs["quest"]).toMatchObject({ stage: "two", completed: true, outcome: "done" });

    // A completed arc is frozen.
    applyEffects([{ kind: "advanceArc", arc: "quest", stage: "one" }], h.ctx);
    expect(h.state.arcs["quest"]!.stage).toBe("two");
  });
});

describe("party effects", () => {
  const party = [
    member({ id: "a", maxHp: 40, hp: 40 }),
    member({ id: "b", maxHp: 40, hp: 12 }),
    member({ id: "c", maxHp: 40, hp: 30 }),
  ];

  it("targets the whole party", () => {
    const h = harness({ startingParty: party });
    applyEffects([{ kind: "damage", amount: 5, target: "party" }], h.ctx);
    expect(h.state.party.map((m) => m.hp)).toEqual([35, 7, 25]);
  });

  it("targets the single lowest-hp member", () => {
    const h = harness({ startingParty: party });
    applyEffects([{ kind: "heal", amount: 100, target: "lowestHp" }], h.ctx);
    expect(h.state.party.map((m) => m.hp)).toEqual([40, 40, 30]);
  });

  it("floors damage at zero and reports the fall", () => {
    const h = harness({ startingParty: [member({ id: "a", maxHp: 40, hp: 3 })] });
    applyEffects([{ kind: "damage", amount: 99, target: "party" }], h.ctx);
    expect(h.state.party[0]!.hp).toBe(0);
    expect(messages(h.log)).toEqual(["a takes 3 damage", "a falls."]);
  });

  it("skips the dead when selecting targets", () => {
    const h = harness({ startingParty: [member({ id: "a", hp: 0 }), member({ id: "b", hp: 20 })] });
    applyEffects([{ kind: "heal", amount: 5, target: "party" }], h.ctx);
    expect(h.state.party[0]!.hp).toBe(0);
    expect(h.state.party[1]!.hp).toBe(25);
  });

  it("extends an injury rather than shortening it", () => {
    const h = harness({ startingParty: [member({ id: "a" })] });
    h.state.day = 10;
    applyEffects([{ kind: "injure", days: 4, target: "leader" }], h.ctx);
    expect(h.state.party[0]!.injuredUntil).toBe(14);
    applyEffects([{ kind: "injure", days: 1, target: "leader" }], h.ctx);
    expect(h.state.party[0]!.injuredUntil).toBe(14);
  });

  it("recruits from the reserve pool, by name or at random", () => {
    const reserves = [member({ id: "x" }), member({ id: "y" })];
    const h = harness({ reserves });
    applyEffects([{ kind: "recruit", member: "y" }], h.ctx);
    expect(h.state.party.map((m) => m.id)).toEqual(["ana", "y"]);
    expect(h.state.reserves).toEqual(["x"]);

    applyEffects([{ kind: "recruit" }], h.ctx);
    expect(h.state.reserves).toEqual([]);
    // Nothing left to draw from: a no-op, not a crash.
    applyEffects([{ kind: "recruit" }], h.ctx);
    expect(h.state.party).toHaveLength(3);
  });

  it("does not recruit someone who is not in the reserve pool", () => {
    const h = harness({ reserves: [member({ id: "x" })] });
    applyEffects([{ kind: "recruit", member: "nobody" }], h.ctx);
    expect(h.state.party).toHaveLength(1);
    expect(h.state.reserves).toEqual(["x"]);
  });
});

describe("world effects", () => {
  it("unlocks a raid exactly once", () => {
    const h = harness({ raids: { "test-raid": soloRaid() } });
    applyEffects(
      [{ kind: "unlockRaid", raid: "test-raid" }, { kind: "unlockRaid", raid: "test-raid" }],
      h.ctx,
    );
    expect(h.state.unlockedRaids).toEqual(["test-raid"]);
  });

  it("schedules events relative to today, never in the past", () => {
    const h = harness();
    h.state.day = 5;
    applyEffects(
      [
        { kind: "scheduleEvent", event: "envoy", inDays: 3 },
        { kind: "scheduleEvent", event: "now", inDays: -2 },
      ],
      h.ctx,
    );
    expect(h.state.scheduled).toEqual([
      { eventId: "envoy", day: 8 },
      { eventId: "now", day: 5 },
    ]);
  });

  it("lets the first ending stand", () => {
    const h = harness();
    applyEffects(
      [
        { kind: "endRun", status: "victory", reason: "won" },
        { kind: "endRun", status: "defeat", reason: "lost" },
      ],
      h.ctx,
    );
    expect(h.state.status).toBe("victory");
    expect(h.state.statusReason).toBe("won");
  });

  it("writes plain log lines on the requested channel", () => {
    const h = harness();
    h.state.day = 2;
    applyEffects([{ kind: "log", message: "hello" }], { ...h.ctx, channel: "narrative" });
    expect(h.log.all()[0]).toEqual({ day: 2, channel: "narrative", message: "hello" });
  });

  it("ignores an undefined effect list", () => {
    const h = harness();
    expect(() => applyEffects(undefined, h.ctx)).not.toThrow();
    expect(h.log.length).toBe(0);
  });
});
