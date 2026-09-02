import type {
  Ability,
  Content,
  PartyMember,
  RaidDefinition,
  ResourceDef,
  WorldState,
} from "../src/core/types";
import { Rng } from "../src/core/rng";
import { GameLog } from "../src/core/log";
import { createWorld } from "../src/core/state";
import type { EffectContext } from "../src/core/effects";

export const testResources: ResourceDef[] = [
  { id: "gold", name: "Gold", min: 0, max: 500, initial: 100 },
  { id: "morale", name: "Morale", min: 0, max: 100, initial: 50 },
  { id: "intel", name: "Intel", min: 0, max: 100, initial: 0 },
  { id: "supplies", name: "Supplies", min: 0, max: 200, initial: 50 },
];

export const testAbilities: Record<string, Ability> = {
  hit: { id: "hit", name: "Hit", kind: "strike", power: 1, cooldown: 0, priority: 1 },
  bigHit: { id: "bigHit", name: "Big Hit", kind: "strike", power: 2, cooldown: 2, priority: 4 },
  sweep: { id: "sweep", name: "Sweep", kind: "volley", power: 0.8, cooldown: 2, priority: 5 },
  mend: { id: "mend", name: "Mend", kind: "mend", power: 15, cooldown: 1, priority: 6 },
  guard: { id: "guard", name: "Guard", kind: "guard", power: 10, cooldown: 2, priority: 5 },
};

export function member(over: Partial<PartyMember> & { id: string }): PartyMember {
  const maxHp = over.maxHp ?? 40;
  return {
    name: over.id,
    role: "ranger",
    level: 1,
    maxHp,
    hp: over.hp ?? maxHp,
    attack: 10,
    defense: 4,
    speed: 5,
    abilities: ["hit"],
    injuredUntil: -1,
    ...over,
  };
}

export function makeContent(over: Partial<Content> = {}): Content {
  return {
    resources: testResources,
    abilities: testAbilities,
    events: [],
    arcs: {},
    raids: {},
    startingParty: [member({ id: "ana" })],
    reserves: [],
    ...over,
  };
}

export interface Harness {
  content: Content;
  state: WorldState;
  log: GameLog;
  rng: Rng;
  ctx: EffectContext;
}

export function harness(over: Partial<Content> = {}, seed = "test"): Harness {
  const content = makeContent(over);
  const state = createWorld(content, seed);
  const log = new GameLog();
  const rng = new Rng(seed);
  return { content, state, log, rng, ctx: { state, content, rng, log } };
}

/** A one-phase raid built around a single enemy, for combat tests. */
export function soloRaid(over: Partial<RaidDefinition> = {}): RaidDefinition {
  return {
    id: "test-raid",
    name: "Test Raid",
    tier: 1,
    maxRounds: 30,
    lootRolls: 1,
    loot: [{ id: "purse", name: "Purse", weight: 1, resource: "gold", amount: [10, 10] }],
    phases: [
      {
        id: "only",
        name: "Only Phase",
        enemies: [{ id: "dummy", name: "Dummy", hp: 30, attack: 5, defense: 0, speed: 1 }],
      },
    ],
    ...over,
  };
}

export function messages(log: GameLog): string[] {
  return log.all().map((entry) => entry.message);
}
