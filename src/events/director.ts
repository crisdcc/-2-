import type { Content, GameEvent, WorldState } from "../core/types";
import type { Rng } from "../core/rng";
import type { GameLog } from "../core/log";
import { evaluate } from "../core/conditions";
import { applyEffects } from "../core/effects";

export interface DirectorOptions {
  /** How many random events the director tries to place each day. */
  eventsPerDay?: number;
}

export interface FiredEvent {
  event: GameEvent;
  /** Scheduled events bypass requirements; rolled ones were selected by weight. */
  source: "rolled" | "scheduled";
}

/**
 * Chooses which world events happen. Selection is a two-stage process: the
 * highest *priority tier* that has any eligible event crowds out every lower
 * tier, and within that tier one event is drawn by weight. That lets urgent
 * story beats pre-empt ambient flavour without giving them absurd weights.
 */
export class EventDirector {
  private readonly byId: Map<string, GameEvent>;
  private readonly eventsPerDay: number;

  constructor(private readonly content: Content, options: DirectorOptions = {}) {
    this.byId = new Map(content.events.map((event) => [event.id, event]));
    if (this.byId.size !== content.events.length) {
      throw new Error("EventDirector: duplicate event ids in content");
    }
    this.eventsPerDay = Math.max(0, options.eventsPerDay ?? 1);
  }

  get(id: string): GameEvent | undefined {
    return this.byId.get(id);
  }

  /** Events whose gates all pass right now, ignoring same-day exclusions. */
  eligible(state: WorldState, exclude: ReadonlySet<string> = new Set()): GameEvent[] {
    return this.content.events.filter((event) => this.isEligible(event, state, exclude));
  }

  private isEligible(
    event: GameEvent,
    state: WorldState,
    exclude: ReadonlySet<string>,
  ): boolean {
    if (exclude.has(event.id)) return false;
    if (event.weight <= 0) return false;

    const record = state.events[event.id];
    if (event.maxFires !== undefined && (record?.count ?? 0) >= event.maxFires) return false;
    if (event.cooldownDays !== undefined && record) {
      if (state.day - record.lastDay < event.cooldownDays) return false;
    }
    return evaluate(event.requires, state);
  }

  /** The eligible events sharing the highest priority tier. */
  private topTier(state: WorldState, exclude: ReadonlySet<string>): GameEvent[] {
    const eligible = this.eligible(state, exclude);
    if (eligible.length === 0) return [];
    const top = Math.max(...eligible.map((event) => event.priority ?? 0));
    return eligible.filter((event) => (event.priority ?? 0) === top);
  }

  /** Runs one day of event placement: scheduled beats first, then rolls. */
  tick(state: WorldState, rng: Rng, log: GameLog): FiredEvent[] {
    const fired: FiredEvent[] = [];
    const seen = new Set<string>();

    for (const event of this.dueScheduled(state)) {
      if (state.status !== "active") break;
      const record = state.events[event.id];
      if (event.maxFires !== undefined && (record?.count ?? 0) >= event.maxFires) continue;
      this.fire(event, state, rng, log);
      seen.add(event.id);
      fired.push({ event, source: "scheduled" });
    }

    for (let i = 0; i < this.eventsPerDay; i++) {
      if (state.status !== "active") break;
      const tier = this.topTier(state, seen);
      const choice = rng.weighted(tier, (event) => event.weight);
      if (!choice) break;
      this.fire(choice, state, rng, log);
      seen.add(choice.id);
      fired.push({ event: choice, source: "rolled" });
    }

    return fired;
  }

  /**
   * Removes and returns the scheduled events that have come due. Unknown ids
   * are dropped rather than silently rescheduled forever.
   */
  private dueScheduled(state: WorldState): GameEvent[] {
    const due: GameEvent[] = [];
    const remaining: { eventId: string; day: number }[] = [];
    for (const entry of state.scheduled) {
      if (entry.day > state.day) {
        remaining.push(entry);
        continue;
      }
      const event = this.byId.get(entry.eventId);
      if (event) due.push(event);
    }
    state.scheduled = remaining;
    return due;
  }

  /** Records and resolves a single event. */
  fire(event: GameEvent, state: WorldState, rng: Rng, log: GameLog): void {
    const record = state.events[event.id] ?? { count: 0, lastDay: -Infinity };
    record.count += 1;
    record.lastDay = state.day;
    state.events[event.id] = record;

    log.write(state.day, "event", `${event.title} — ${event.narration}`);
    applyEffects(event.effects, {
      state,
      content: this.content,
      rng: rng.stream(`event:${event.id}:${state.day}:${record.count}`),
      log,
      channel: "event",
    });
  }
}
