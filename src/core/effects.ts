import type { Content, Effect, PartyMember, TargetSelector, WorldState } from "./types";
import type { Rng } from "./rng";
import type { GameLog } from "./log";
import { addResource, cloneMember, livingParty } from "./state";

export interface EffectContext {
  state: WorldState;
  content: Content;
  rng: Rng;
  log: GameLog;
  /** Log channel used for messages produced while applying these effects. */
  channel?: "event" | "narrative" | "choice" | "raid" | "system";
}

function resolveTargets(selector: TargetSelector, state: WorldState, rng: Rng): PartyMember[] {
  const alive = livingParty(state);
  if (alive.length === 0) return [];

  switch (selector) {
    case "party":
      return alive;
    case "leader":
      return [alive[0]!];
    case "random":
      return [rng.pick(alive)];
    case "lowestHp": {
      let best = alive[0]!;
      for (const member of alive) {
        if (member.hp < best.hp) best = member;
      }
      return [best];
    }
    default: {
      const exhaustive: never = selector;
      throw new Error(`Unknown target selector: ${String(exhaustive)}`);
    }
  }
}

/**
 * Applies a list of effects in order. Effects are the single mutation path into
 * world state, so every content-driven change is auditable in one place.
 */
export function applyEffects(effects: Effect[] | undefined, ctx: EffectContext): void {
  if (!effects) return;
  for (const effect of effects) applyEffect(effect, ctx);
}

export function applyEffect(effect: Effect, ctx: EffectContext): void {
  const { state, content, rng, log } = ctx;
  const channel = ctx.channel ?? "system";
  const day = state.day;

  switch (effect.kind) {
    case "resource": {
      const applied = addResource(state, content, effect.resource, effect.delta);
      if (applied !== 0) {
        const sign = applied > 0 ? "+" : "";
        log.write(day, channel, `${effect.resource} ${sign}${applied}`);
      }
      return;
    }

    case "setFlag": {
      state.flags[effect.flag] = effect.value ?? true;
      return;
    }

    case "startArc": {
      const arc = content.arcs[effect.arc];
      if (!arc) throw new Error(`startArc: unknown arc "${effect.arc}"`);
      const existing = state.arcs[effect.arc];
      // Completed arcs stay completed; re-entering them would rewrite history.
      if (existing) return;
      state.arcs[effect.arc] = {
        arcId: arc.id,
        stage: arc.start,
        startedDay: day,
        completed: false,
        history: [],
      };
      return;
    }

    case "advanceArc": {
      const arcState = state.arcs[effect.arc];
      const arc = content.arcs[effect.arc];
      if (!arc) throw new Error(`advanceArc: unknown arc "${effect.arc}"`);
      if (!arc.stages[effect.stage]) {
        throw new Error(`advanceArc: arc "${effect.arc}" has no stage "${effect.stage}"`);
      }
      if (!arcState || arcState.completed) return;
      arcState.stage = effect.stage;
      return;
    }

    case "completeArc": {
      const arcState = state.arcs[effect.arc];
      if (!arcState || arcState.completed) return;
      arcState.completed = true;
      if (effect.outcome !== undefined) arcState.outcome = effect.outcome;
      return;
    }

    case "heal": {
      for (const member of resolveTargets(effect.target, state, rng)) {
        const before = member.hp;
        member.hp = Math.min(member.maxHp, member.hp + effect.amount);
        if (member.hp > before) {
          log.write(day, channel, `${member.name} recovers ${member.hp - before} hp`);
        }
      }
      return;
    }

    case "damage": {
      for (const member of resolveTargets(effect.target, state, rng)) {
        const before = member.hp;
        member.hp = Math.max(0, member.hp - effect.amount);
        const dealt = before - member.hp;
        if (dealt > 0) log.write(day, channel, `${member.name} takes ${dealt} damage`);
        if (member.hp === 0) log.write(day, channel, `${member.name} falls.`);
      }
      return;
    }

    case "injure": {
      for (const member of resolveTargets(effect.target, state, rng)) {
        member.injuredUntil = Math.max(member.injuredUntil, day + effect.days);
        log.write(day, channel, `${member.name} is laid up until day ${member.injuredUntil}`);
      }
      return;
    }

    case "recruit": {
      const wanted = effect.member;
      const pool = wanted
        ? state.reserves.filter((id) => id === wanted)
        : state.reserves;
      if (pool.length === 0) return;
      const id = wanted ? pool[0]! : rng.pick(pool);
      const template = content.reserves.find((member) => member.id === id);
      if (!template) return;
      state.reserves = state.reserves.filter((reserve) => reserve !== id);
      state.party.push(cloneMember(template));
      log.write(day, channel, `${template.name} joins the company.`);
      return;
    }

    case "unlockRaid": {
      if (!content.raids[effect.raid]) throw new Error(`unlockRaid: unknown raid "${effect.raid}"`);
      if (!state.unlockedRaids.includes(effect.raid)) {
        state.unlockedRaids.push(effect.raid);
        log.write(day, channel, `${content.raids[effect.raid]!.name} lies open to the company.`);
      }
      return;
    }

    case "scheduleEvent": {
      state.scheduled.push({ eventId: effect.event, day: day + Math.max(0, effect.inDays) });
      return;
    }

    case "endRun": {
      // The first ending sticks; later effects in the same batch cannot override it.
      if (state.status !== "active") return;
      state.status = effect.status;
      state.statusReason = effect.reason;
      log.write(day, "system", effect.reason);
      return;
    }

    case "log": {
      log.write(day, channel, effect.message);
      return;
    }

    default: {
      const exhaustive: never = effect;
      throw new Error(`Unknown effect kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
