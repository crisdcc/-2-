import { describe, expect, it } from "vitest";
import { Game } from "../src/sim/game";
import { neverRaid } from "../src/raid/expedition";
import { firstAvailable, randomChoice, scripted } from "../src/narrative/engine";
import { emberMarches } from "../src/content";
import type { Content, GameEvent } from "../src/core/types";
import { makeContent, member, soloRaid } from "./fixtures";

/** A campaign with no content of its own, so upkeep can be observed in isolation. */
function quietContent(over: Partial<Content> = {}): Content {
  return makeContent({
    startingParty: [member({ id: "a" }), member({ id: "b" })],
    ...over,
  });
}

describe("Game day loop", () => {
  it("advances one day at a time and reports what happened", () => {
    const game = new Game({ content: quietContent(), seed: "s", raidPlanner: neverRaid });
    expect(game.state.day).toBe(0);

    const report = game.tick();
    expect(report.day).toBe(1);
    expect(report.status).toBe("active");
    expect(game.state.day).toBe(1);
    expect(report.entries.every((entry) => entry.day === 1)).toBe(true);
  });

  it("eats supplies and wears down morale each day", () => {
    const game = new Game({ content: quietContent(), seed: "s", raidPlanner: neverRaid });
    game.run(3);
    // Two members, three days of upkeep, plus one morale lost per day.
    expect(game.state.resources["supplies"]).toBe(50 - 2 * 3);
    expect(game.state.resources["morale"]).toBe(50 - 3);
  });

  it("goes hungry when the stores cannot cover upkeep", () => {
    const game = new Game({ content: quietContent(), seed: "s", raidPlanner: neverRaid });
    game.state.resources["supplies"] = 1;
    game.tick();

    expect(game.state.resources["supplies"]).toBe(0);
    expect(game.state.resources["morale"]).toBe(50 - 6 - 1);
    expect(game.log.all().map((e) => e.message)).toContain(
      "The stores run dry. The company goes hungry.",
    );
  });

  it("lets the party rest, without healing past full or reviving the dead", () => {
    const game = new Game({ content: quietContent(), seed: "s", raidPlanner: neverRaid });
    game.state.party[0]!.hp = 10;
    game.state.party[1]!.hp = 0;
    game.tick();

    expect(game.state.party[0]!.hp).toBe(10 + Math.ceil(40 * 0.08));
    expect(game.state.party[1]!.hp).toBe(0);

    game.state.party[0]!.hp = 40;
    game.tick();
    expect(game.state.party[0]!.hp).toBe(40);
  });

  it("ends the run when the company loses heart", () => {
    const game = new Game({ content: quietContent(), seed: "s", raidPlanner: neverRaid });
    game.state.resources["morale"] = 1;
    game.tick();

    expect(game.state.status).toBe("defeat");
    expect(game.state.statusReason).toBe("The company loses heart and scatters.");
  });

  it("ends the run when nobody is left standing", () => {
    const game = new Game({ content: quietContent(), seed: "s", raidPlanner: neverRaid });
    for (const m of game.state.party) m.hp = 0;
    game.tick();

    expect(game.state.status).toBe("defeat");
    expect(game.state.statusReason).toBe("No one is left standing.");
  });

  it("stops running once the outcome is decided", () => {
    const ending: GameEvent = {
      id: "end", title: "End", category: "world", weight: 1, narration: "it ends",
      effects: [{ kind: "endRun", status: "victory", reason: "done" }],
    };
    const game = new Game({
      content: quietContent({ events: [ending] }),
      seed: "s",
      raidPlanner: neverRaid,
    });
    const reports = game.run(20);

    expect(reports).toHaveLength(1);
    expect(game.finished).toBe(true);
    expect(game.state.status).toBe("victory");

    const after = game.tick();
    expect(after.entries).toEqual([]);
    expect(game.state.day).toBe(1);
  });
});

describe("Game wiring", () => {
  it("validates its content up front", () => {
    const broken = makeContent({ startingParty: [member({ id: "a", abilities: ["ghost"] })] });
    expect(() => new Game({ content: broken })).toThrow(/Invalid content/);
    expect(() => new Game({ content: broken, skipValidation: true })).not.toThrow();
  });

  it("refuses a planner that picks a raid the company cannot attempt", () => {
    const raid = soloRaid({ requires: { kind: "never" } });
    const game = new Game({
      content: quietContent({ raids: { "test-raid": raid } }),
      seed: "s",
      raidPlanner: () => "test-raid",
    });
    game.state.unlockedRaids.push("test-raid");
    expect(() => game.tick()).toThrow(/unavailable raid/);
  });

  it("refuses a planner that names a raid that does not exist", () => {
    const game = new Game({
      content: quietContent(),
      seed: "s",
      raidPlanner: () => "ghost",
    });
    expect(() => game.tick()).toThrow(/unknown raid/);
  });

  it("never raids when told not to", () => {
    const game = new Game({ seed: "s", raidPlanner: neverRaid });
    game.run(60);
    expect(game.state.raids).toEqual([]);
    expect(game.state.clearedRaids).toEqual([]);
  });

  it("places the requested number of events per day", () => {
    const events: GameEvent[] = ["a", "b", "c"].map((id) => ({
      id, title: id, category: "world", weight: 1, narration: id,
    }));
    const busy = new Game({
      content: quietContent({ events }),
      seed: "s",
      eventsPerDay: 3,
      raidPlanner: neverRaid,
    });
    busy.tick();
    const fired = Object.values(busy.state.events).reduce((sum, r) => sum + r.count, 0);
    expect(fired).toBe(3);

    const idle = new Game({
      content: quietContent({ events }),
      seed: "s",
      eventsPerDay: 0,
      raidPlanner: neverRaid,
    });
    idle.tick();
    expect(idle.state.events).toEqual({});
  });
});

describe("determinism", () => {
  const snapshot = (game: Game): string =>
    JSON.stringify({ log: game.log.all(), state: game.state });

  it("replays a whole campaign identically from the same seed", () => {
    const a = new Game({ seed: "reproduce" });
    const b = new Game({ seed: "reproduce" });
    a.run(80);
    b.run(80);
    expect(snapshot(a)).toBe(snapshot(b));
    expect(a.log.length).toBeGreaterThan(20);
  });

  it("diverges on a different seed", () => {
    const a = new Game({ seed: "one" });
    const b = new Game({ seed: "two" });
    a.run(80);
    b.run(80);
    expect(snapshot(a)).not.toBe(snapshot(b));
  });

  it("is unaffected by how many days are requested per call", () => {
    const whole = new Game({ seed: "chunks" });
    whole.run(30);

    const pieces = new Game({ seed: "chunks" });
    for (let i = 0; i < 30; i++) pieces.tick();

    expect(snapshot(pieces)).toBe(snapshot(whole));
  });

  it("changes with the choice strategy, not with the seed alone", () => {
    const first = new Game({ seed: "choices", chooser: firstAvailable });
    const other = new Game({ seed: "choices", chooser: scripted({ compact: "pledge" }) });
    first.run(60);
    other.run(60);
    expect(snapshot(first)).not.toBe(snapshot(other));
  });
});

describe("the Ember Marches campaign", () => {
  it("plays through to a sealed hold on its default seed", () => {
    const game = new Game({ seed: "ember" });
    game.run(80);

    expect(game.state.status).toBe("victory");
    expect(game.state.clearedRaids).toEqual(["ashen-barrow", "ember-hold"]);
    expect(game.state.arcs["compact"]).toMatchObject({ completed: true, outcome: "sealed" });
  });

  it("collapses without raids to sustain it", () => {
    const game = new Game({ seed: "ember", raidPlanner: neverRaid });
    game.run(300);
    expect(game.state.status).toBe("defeat");
  });

  it("reaches every outcome across a spread of seeds and strategies", () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const game = new Game({ seed: `spread-${i}`, chooser: randomChoice });
      game.run(150);
      outcomes.add(game.state.status);
    }
    expect(outcomes.has("victory")).toBe(true);
    expect(outcomes.has("defeat")).toBe(true);
  });

  it("keeps the shipped content self-consistent while it runs", () => {
    const game = new Game({ seed: "invariants", chooser: randomChoice });
    game.run(120);

    for (const [id, value] of Object.entries(game.state.resources)) {
      const def = emberMarches.resources.find((r) => r.id === id)!;
      expect(value).toBeGreaterThanOrEqual(def.min);
      expect(value).toBeLessThanOrEqual(def.max);
    }
    for (const m of game.state.party) {
      expect(m.hp).toBeGreaterThanOrEqual(0);
      expect(m.hp).toBeLessThanOrEqual(m.maxHp);
    }
    const ids = game.state.party.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(game.state.reserves).not.toContain(id);
  });
});
