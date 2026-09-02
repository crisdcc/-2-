import type { Content, PartyMember, ResourceDef, WorldState } from "./types";

/** Total combat power of the healthy party — the yardstick for raid gating. */
export function partyPower(state: WorldState): number {
  return state.party
    .filter((member) => member.hp > 0)
    .reduce((sum, m) => sum + m.attack * 2 + m.defense + Math.floor(m.maxHp / 10), 0);
}

export function livingParty(state: WorldState): PartyMember[] {
  return state.party.filter((member) => member.hp > 0);
}

/** Members who can actually be fielded on a raid today. */
export function readyParty(state: WorldState): PartyMember[] {
  return state.party.filter((member) => member.hp > 0 && member.injuredUntil < state.day);
}

export function findMember(state: WorldState, id: string): PartyMember | undefined {
  return state.party.find((member) => member.id === id);
}

export function resourceDef(content: Content, id: string): ResourceDef | undefined {
  return content.resources.find((def) => def.id === id);
}

/**
 * Writes a resource, clamped to its declared bounds. Returns the actual delta
 * applied, which differs from the requested one whenever a bound bites.
 */
export function setResource(
  state: WorldState,
  content: Content,
  id: string,
  value: number,
): number {
  const def = resourceDef(content, id);
  const before = state.resources[id] ?? 0;
  const clamped = def ? Math.min(def.max, Math.max(def.min, value)) : value;
  state.resources[id] = clamped;
  return clamped - before;
}

export function addResource(
  state: WorldState,
  content: Content,
  id: string,
  delta: number,
): number {
  return setResource(state, content, id, (state.resources[id] ?? 0) + delta);
}

export function cloneMember(member: PartyMember): PartyMember {
  return { ...member, abilities: [...member.abilities] };
}

/** Builds the opening world state for a run. Content is never mutated. */
export function createWorld(content: Content, seed: string): WorldState {
  const resources: Record<string, number> = {};
  for (const def of content.resources) {
    resources[def.id] = Math.min(def.max, Math.max(def.min, def.initial));
  }

  return {
    seed,
    day: 0,
    resources,
    flags: {},
    party: content.startingParty.map(cloneMember),
    reserves: content.reserves.map((member) => member.id),
    arcs: {},
    events: {},
    scheduled: [],
    unlockedRaids: [],
    clearedRaids: [],
    raids: [],
    lastRaidDay: -Infinity,
    status: "active",
  };
}
