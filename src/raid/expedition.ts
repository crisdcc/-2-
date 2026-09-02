import type { Content, RaidDefinition, WorldState } from "../core/types";
import type { EffectContext } from "../core/effects";
import { applyEffects } from "../core/effects";
import { addResource, findMember, readyParty } from "../core/state";
import { evaluate } from "../core/conditions";
import type { RaidResult } from "./combat";

/** Days a downed member spends recovering before they can march again. */
export const INJURY_DAYS = 2;

/**
 * Chooses which raid (if any) the company attempts today. Returning `null`
 * means "rest instead".
 */
export type RaidStrategy = (
  state: WorldState,
  candidates: RaidDefinition[],
  content: Content,
) => string | null;

/** Raids that are unlocked and whose own requirements currently pass. */
export function availableRaids(state: WorldState, content: Content): RaidDefinition[] {
  return state.unlockedRaids
    .map((id) => content.raids[id])
    .filter((raid): raid is RaidDefinition => raid !== undefined)
    .filter((raid) => evaluate(raid.requires, state))
    .sort((a, b) => b.tier - a.tier || (a.id < b.id ? -1 : 1));
}

export interface CautiousOptions {
  minParty?: number;
  minHealthRatio?: number;
  restDays?: number;
}

/**
 * The default planner: march only with a real party at decent health, and only
 * after resting. Prefers ground the company has not taken yet, falling back to
 * the toughest cleared raid to keep farming it.
 */
export function cautiousPlanner(options: CautiousOptions = {}): RaidStrategy {
  const minParty = options.minParty ?? 3;
  const minHealthRatio = options.minHealthRatio ?? 0.75;
  const restDays = options.restDays ?? 3;

  return (state, candidates) => {
    if (candidates.length === 0) return null;

    const ready = readyParty(state);
    if (ready.length < minParty) return null;
    if (state.day - state.lastRaidDay < restDays) return null;

    const totalHp = ready.reduce((sum, m) => sum + m.hp, 0);
    const totalMax = ready.reduce((sum, m) => sum + m.maxHp, 0);
    if (totalMax === 0 || totalHp / totalMax < minHealthRatio) return null;

    const fresh = candidates.find((raid) => !state.clearedRaids.includes(raid.id));
    return (fresh ?? candidates[0]!).id;
  };
}

/** Never raids. Useful for isolating the event and narrative systems in tests. */
export const neverRaid: RaidStrategy = () => null;

/**
 * Writes a finished raid back into the world: casualties, loot, clear status
 * and the raid's own victory or defeat effects.
 */
export function applyRaidResult(
  result: RaidResult,
  raid: RaidDefinition,
  ctx: EffectContext,
): void {
  const { state, content, log } = ctx;
  const day = state.day;

  for (const line of result.log) log.write(day, "raid", line);

  for (const [memberId, hp] of Object.entries(result.finalHp)) {
    const member = findMember(state, memberId);
    if (!member) continue;
    if (hp <= 0) {
      // Downed members are carried home rather than killed outright; the run
      // ends through morale and story, not through a single bad fight.
      member.hp = 1;
      member.injuredUntil = day + INJURY_DAYS;
      log.write(day, "raid", `${member.name} is carried back, out of the fight until day ${member.injuredUntil}.`);
    } else {
      member.hp = hp;
    }
  }

  for (const drop of result.loot) {
    const applied = addResource(state, content, drop.resource, drop.amount);
    if (applied !== 0) log.write(day, "loot", `${drop.name}: ${drop.resource} +${applied}`);
  }

  state.raids.push({ day, raidId: raid.id, outcome: result.outcome, rounds: result.rounds });
  state.lastRaidDay = day;

  if (result.outcome === "victory") {
    if (!state.clearedRaids.includes(raid.id)) state.clearedRaids.push(raid.id);
    applyEffects(raid.onVictory, { ...ctx, channel: "raid" });
  } else {
    applyEffects(raid.onDefeat, { ...ctx, channel: "raid" });
  }
}
