import { describe, expect, it } from "vitest";
import { resolveRaid } from "../src/raid/combat";
import {
  INJURY_DAYS,
  applyRaidResult,
  availableRaids,
  cautiousPlanner,
  neverRaid,
} from "../src/raid/expedition";
import { Rng } from "../src/core/rng";
import type { RaidDefinition } from "../src/core/types";
import { harness, member, messages, soloRaid } from "./fixtures";

const strong = [
  member({ id: "a", maxHp: 80, attack: 20, defense: 6, speed: 9, abilities: ["bigHit", "hit"] }),
  member({ id: "b", maxHp: 80, attack: 20, defense: 6, speed: 7, abilities: ["hit"] }),
];

function fight(raid: RaidDefinition, party = strong, seed = "fight", verbose = false) {
  const h = harness({ startingParty: party, raids: { [raid.id]: raid } });
  return resolveRaid(raid, h.state.party, h.content, new Rng(seed), { verbose });
}

describe("resolveRaid", () => {
  it("is deterministic for a given seed", () => {
    const raid = soloRaid({
      phases: [
        {
          id: "only", name: "Only",
          enemies: [{ id: "e", name: "Foe", hp: 60, attack: 9, defense: 2, speed: 6, count: 2 }],
        },
      ],
    });
    const a = fight(raid, strong, "same");
    const b = fight(raid, strong, "same");
    expect(a).toEqual(b);
    expect(fight(raid, strong, "other")).not.toEqual(a);
  });

  it("calls the raid off when nobody can march", () => {
    const result = fight(soloRaid(), []);
    expect(result.outcome).toBe("retreat");
    expect(result.rounds).toBe(0);
    expect(result.loot).toEqual([]);
    expect(result.log[0]).toMatch(/No one is fit to march/);
  });

  it("clears every phase on a win and records the damage dealt", () => {
    const raid = soloRaid({
      phases: [
        { id: "one", name: "One", enemies: [{ id: "e", name: "E", hp: 20, attack: 2, defense: 0, speed: 1 }] },
        { id: "two", name: "Two", enemies: [{ id: "f", name: "F", hp: 20, attack: 2, defense: 0, speed: 1 }] },
      ],
    });
    const result = fight(raid);
    expect(result.outcome).toBe("victory");
    expect(result.phasesCleared).toBe(2);
    expect(result.totalPhases).toBe(2);
    expect(result.damageDealt).toBeGreaterThan(0);
    expect(result.log).toContain("Test Raid falls to the company.");
  });

  it("withdraws when the round budget runs out", () => {
    const raid = soloRaid({
      maxRounds: 2,
      phases: [
        { id: "only", name: "Only", enemies: [{ id: "wall", name: "Wall", hp: 99999, attack: 0, defense: 0, speed: 1 }] },
      ],
    });
    const result = fight(raid);
    expect(result.outcome).toBe("retreat");
    expect(result.rounds).toBe(2);
    expect(result.phasesCleared).toBe(0);
    expect(result.loot).toEqual([]);
  });

  it("reports a wipe and names who went down", () => {
    const raid = soloRaid({
      phases: [
        { id: "only", name: "Only", enemies: [{ id: "titan", name: "Titan", hp: 9999, attack: 80, defense: 50, speed: 99 }] },
      ],
    });
    const result = fight(raid, [member({ id: "a", maxHp: 10, defense: 0, attack: 1 })]);
    expect(result.outcome).toBe("wipe");
    expect(result.downed).toEqual(["a"]);
    expect(result.finalHp["a"]).toBe(0);
    expect(result.log).toContain("The company is broken.");
  });

  it("rolls loot only on a win, once per configured roll", () => {
    const raid = soloRaid({ lootRolls: 3 });
    const result = fight(raid);
    expect(result.outcome).toBe("victory");
    expect(result.loot).toHaveLength(3);
    expect(result.loot.every((drop) => drop.resource === "gold" && drop.amount === 10)).toBe(true);
  });

  it("returns the surviving hp of everyone who was fielded", () => {
    const result = fight(soloRaid());
    expect(Object.keys(result.finalHp).sort()).toEqual(["a", "b"]);
    for (const hp of Object.values(result.finalHp)) expect(hp).toBeGreaterThan(0);
  });

  it("fires an area mechanic on its cadence", () => {
    const raid = soloRaid({
      maxRounds: 6,
      phases: [
        {
          id: "only", name: "Only",
          enemies: [{ id: "wall", name: "Wall", hp: 99999, attack: 0, defense: 0, speed: 1 }],
          mechanics: [{ kind: "aoe", everyRounds: 2, damage: 3, name: "Grave-chill" }],
        },
      ],
    });
    const result = fight(raid);
    expect(result.log.filter((line) => line.includes("Grave-chill"))).toHaveLength(3);
    expect(result.damageTaken).toBeGreaterThanOrEqual(3 * 3 * strong.length);
  });

  it("announces an enrage once, when it starts", () => {
    const raid = soloRaid({
      maxRounds: 5,
      phases: [
        {
          id: "only", name: "Only Phase",
          enemies: [{ id: "wall", name: "Wall", hp: 99999, attack: 5, defense: 0, speed: 1 }],
          mechanics: [{ kind: "enrage", afterRound: 2, attackBonus: 5 }],
        },
      ],
    });
    const result = fight(raid);
    expect(result.log.filter((line) => line.includes("enrages"))).toHaveLength(1);
  });

  it("brings in reinforcements and shields the enemy on cadence", () => {
    const raid = soloRaid({
      maxRounds: 4,
      phases: [
        {
          id: "only", name: "Only",
          enemies: [{ id: "wall", name: "Wall", hp: 99999, attack: 0, defense: 0, speed: 1 }],
          mechanics: [
            { kind: "adds", everyRounds: 2, name: "More of them", template: { id: "add", name: "Add", hp: 5, attack: 1, defense: 0, speed: 1 } },
            { kind: "shield", everyRounds: 3, amount: 10, name: "A ward" },
          ],
        },
      ],
    });
    const result = fight(raid);
    expect(result.log.filter((line) => line === "More of them arrive.")).toHaveLength(2);
    expect(result.log.filter((line) => line === "A ward hardens the enemy.")).toHaveLength(1);
  });

  it("has healers mend the most wounded ally", () => {
    const party = [
      member({ id: "hurt", maxHp: 60, hp: 10, attack: 5, abilities: ["hit"] }),
      member({ id: "healer", maxHp: 60, attack: 10, abilities: ["mend", "hit"] }),
    ];
    const raid = soloRaid({
      maxRounds: 3,
      phases: [
        { id: "only", name: "Only", enemies: [{ id: "wall", name: "Wall", hp: 99999, attack: 0, defense: 0, speed: 1 }] },
      ],
    });
    const result = fight(raid, party, "heal", true);
    expect(result.log.some((line) => /healer mends hurt for \d+/.test(line))).toBe(true);
    expect(result.finalHp["hurt"]!).toBeGreaterThan(10);
  });

  it("uses area damage only when there is a crowd to hit", () => {
    const caster = [member({ id: "mage", maxHp: 60, attack: 12, abilities: ["sweep", "hit"] })];
    const crowd = soloRaid({
      maxRounds: 1,
      phases: [
        { id: "only", name: "Only", enemies: [{ id: "e", name: "E", hp: 500, attack: 0, defense: 0, speed: 1, count: 3 }] },
      ],
    });
    const lone = soloRaid({
      maxRounds: 1,
      phases: [
        { id: "only", name: "Only", enemies: [{ id: "e", name: "E", hp: 500, attack: 0, defense: 0, speed: 1 }] },
      ],
    });
    expect(fight(crowd, caster, "s", true).log.some((l) => l.includes("looses Sweep"))).toBe(true);
    expect(fight(lone, caster, "s", true).log.some((l) => l.includes("looses Sweep"))).toBe(false);
  });

  it("keeps quiet about individual blows unless asked", () => {
    const terse = fight(soloRaid(), strong, "v", false);
    const loud = fight(soloRaid(), strong, "v", true);
    expect(loud.log.length).toBeGreaterThan(terse.log.length);
    expect(loud.outcome).toBe(terse.outcome);
  });
});

describe("availableRaids", () => {
  it("lists unlocked raids that pass their own requirements, hardest first", () => {
    const easy = soloRaid({ id: "easy", name: "Easy", tier: 1 });
    const hard = soloRaid({ id: "hard", name: "Hard", tier: 3, requires: { kind: "flag", flag: "ready" } });
    const h = harness({ raids: { easy, hard } });

    expect(availableRaids(h.state, h.content)).toEqual([]);
    h.state.unlockedRaids.push("easy", "hard", "ghost");
    expect(availableRaids(h.state, h.content).map((r) => r.id)).toEqual(["easy"]);

    h.state.flags["ready"] = true;
    expect(availableRaids(h.state, h.content).map((r) => r.id)).toEqual(["hard", "easy"]);
  });
});

describe("cautiousPlanner", () => {
  const raid = soloRaid();

  function plannerHarness(over = {}) {
    const h = harness({
      startingParty: [member({ id: "a" }), member({ id: "b" }), member({ id: "c" })],
      raids: { "test-raid": raid },
      ...over,
    });
    h.state.day = 10;
    h.state.unlockedRaids.push("test-raid");
    return h;
  }

  it("marches when the company is rested, healthy and large enough", () => {
    const h = plannerHarness();
    expect(cautiousPlanner()(h.state, availableRaids(h.state, h.content), h.content)).toBe("test-raid");
  });

  it("stays home with too few able bodies", () => {
    const h = plannerHarness();
    h.state.party[0]!.injuredUntil = 20;
    expect(cautiousPlanner()(h.state, availableRaids(h.state, h.content), h.content)).toBeNull();
  });

  it("stays home while the company is still hurt", () => {
    const h = plannerHarness();
    for (const m of h.state.party) m.hp = 10;
    expect(cautiousPlanner()(h.state, availableRaids(h.state, h.content), h.content)).toBeNull();
  });

  it("stays home until it has rested", () => {
    const h = plannerHarness();
    h.state.lastRaidDay = 9;
    expect(cautiousPlanner()(h.state, availableRaids(h.state, h.content), h.content)).toBeNull();
    expect(cautiousPlanner({ restDays: 1 })(h.state, availableRaids(h.state, h.content), h.content))
      .toBe("test-raid");
  });

  it("prefers ground it has not taken, then falls back to the toughest cleared raid", () => {
    const second = soloRaid({ id: "second", name: "Second", tier: 2 });
    const h = plannerHarness({ raids: { "test-raid": raid, second } });
    h.state.unlockedRaids.push("second");
    expect(cautiousPlanner()(h.state, availableRaids(h.state, h.content), h.content)).toBe("second");

    h.state.clearedRaids.push("second");
    expect(cautiousPlanner()(h.state, availableRaids(h.state, h.content), h.content)).toBe("test-raid");

    h.state.clearedRaids.push("test-raid");
    expect(cautiousPlanner()(h.state, availableRaids(h.state, h.content), h.content)).toBe("second");
  });

  it("never marches with nothing available, and neverRaid never marches at all", () => {
    const h = plannerHarness();
    expect(cautiousPlanner()(h.state, [], h.content)).toBeNull();
    expect(neverRaid(h.state, availableRaids(h.state, h.content), h.content)).toBeNull();
  });
});

describe("applyRaidResult", () => {
  it("banks loot, marks the raid cleared and runs its victory effects", () => {
    const raid = soloRaid({
      onVictory: [{ kind: "resource", resource: "morale", delta: 5 }],
      onDefeat: [{ kind: "resource", resource: "morale", delta: -5 }],
    });
    const h = harness({ startingParty: strong, raids: { "test-raid": raid } });
    h.state.day = 4;
    const result = resolveRaid(raid, h.state.party, h.content, new Rng("win"));
    expect(result.outcome).toBe("victory");

    applyRaidResult(result, raid, h.ctx);
    expect(h.state.resources["gold"]).toBe(110);
    expect(h.state.resources["morale"]).toBe(55);
    expect(h.state.clearedRaids).toEqual(["test-raid"]);
    expect(h.state.lastRaidDay).toBe(4);
    expect(h.state.raids).toEqual([
      { day: 4, raidId: "test-raid", outcome: "victory", rounds: result.rounds },
    ]);
  });

  it("does not mark a raid cleared twice", () => {
    const raid = soloRaid();
    const h = harness({ startingParty: strong, raids: { "test-raid": raid } });
    for (const seed of ["one", "two"]) {
      const result = resolveRaid(raid, h.state.party, h.content, new Rng(seed));
      applyRaidResult(result, raid, h.ctx);
    }
    expect(h.state.clearedRaids).toEqual(["test-raid"]);
    expect(h.state.raids).toHaveLength(2);
  });

  it("carries the downed home at 1 hp and lays them up", () => {
    const raid = soloRaid({
      onDefeat: [{ kind: "resource", resource: "morale", delta: -5 }],
      phases: [
        { id: "only", name: "Only", enemies: [{ id: "titan", name: "Titan", hp: 9999, attack: 80, defense: 50, speed: 99 }] },
      ],
    });
    const h = harness({
      startingParty: [member({ id: "a", maxHp: 10, defense: 0, attack: 1 })],
      raids: { "test-raid": raid },
    });
    h.state.day = 6;
    const result = resolveRaid(raid, h.state.party, h.content, new Rng("lose"));
    applyRaidResult(result, raid, h.ctx);

    expect(h.state.party[0]!.hp).toBe(1);
    expect(h.state.party[0]!.injuredUntil).toBe(6 + INJURY_DAYS);
    expect(h.state.clearedRaids).toEqual([]);
    expect(h.state.resources["morale"]).toBe(45);
    expect(messages(h.log).some((m) => m.includes("carried back"))).toBe(true);
  });
});
