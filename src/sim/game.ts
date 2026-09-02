import type { Content, LogEntry, RunStatus, WorldState } from "../core/types";
import { Rng } from "../core/rng";
import { GameLog } from "../core/log";
import { createWorld, livingParty, readyParty } from "../core/state";
import { addResource } from "../core/state";
import { applyEffects } from "../core/effects";
import { EventDirector } from "../events/director";
import { NarrativeEngine, firstAvailable, type ChoiceStrategy } from "../narrative/engine";
import { resolveRaid } from "../raid/combat";
import {
  applyRaidResult,
  availableRaids,
  cautiousPlanner,
  type RaidStrategy,
} from "../raid/expedition";
import { emberMarches } from "../content";
import { assertValidContent } from "./validate";

/** Supplies eaten per living member, per day. */
const UPKEEP_PER_MEMBER = 1;
/** Morale lost on a day the company cannot feed itself. */
const STARVATION_MORALE = 6;
/** Fraction of max hp recovered by resting each morning. */
const REST_FRACTION = 0.08;
/** Morale lost every day simply for being in the field. */
const MORALE_DRIFT = 1;

export interface GameOptions {
  seed?: string;
  content?: Content;
  chooser?: ChoiceStrategy;
  raidPlanner?: RaidStrategy;
  eventsPerDay?: number;
  verboseRaids?: boolean;
  /** Skip the content validation pass. Only useful for deliberately broken fixtures. */
  skipValidation?: boolean;
}

export interface DayReport {
  day: number;
  entries: LogEntry[];
  status: RunStatus;
}

/**
 * Ties the three systems together into a day loop:
 * upkeep → world events → narrative → raid → narrative again → end checks.
 *
 * Everything downstream of the seed is deterministic, so two `Game`s built with
 * the same seed, content and strategies produce byte-identical chronicles.
 */
export class Game {
  readonly state: WorldState;
  readonly log = new GameLog();
  readonly content: Content;

  private readonly rng: Rng;
  private readonly director: EventDirector;
  private readonly narrative: NarrativeEngine;
  private readonly chooser: ChoiceStrategy;
  private readonly planner: RaidStrategy;
  private readonly verboseRaids: boolean;

  constructor(options: GameOptions = {}) {
    this.content = options.content ?? emberMarches;
    if (!options.skipValidation) assertValidContent(this.content);

    const seed = options.seed ?? "ember";
    this.rng = new Rng(seed);
    this.state = createWorld(this.content, seed);
    this.director = new EventDirector(this.content, { eventsPerDay: options.eventsPerDay ?? 1 });
    this.narrative = new NarrativeEngine(this.content);
    this.chooser = options.chooser ?? firstAvailable;
    this.planner = options.raidPlanner ?? cautiousPlanner();
    this.verboseRaids = options.verboseRaids ?? false;
  }

  get finished(): boolean {
    return this.state.status !== "active";
  }

  /** Advances the world by one day and returns everything that happened. */
  tick(): DayReport {
    if (this.finished) {
      return { day: this.state.day, entries: [], status: this.state.status };
    }

    const mark = this.log.length;
    this.state.day += 1;
    const dayRng = this.rng.stream(`day:${this.state.day}`);

    this.upkeep();
    if (this.state.status === "active") {
      this.director.tick(this.state, dayRng.stream("events"), this.log);
    }
    if (this.state.status === "active") {
      this.narrative.tick(this.state, dayRng.stream("narrative"), this.log, this.chooser);
    }
    if (this.state.status === "active") {
      this.expedition(dayRng);
      // Run the narrative again so a raid cleared today can advance its arc
      // on the same day rather than a day later.
      this.narrative.tick(this.state, dayRng.stream("narrative-post"), this.log, this.chooser);
    }
    this.checkEnd();

    return {
      day: this.state.day,
      entries: this.log.since(mark),
      status: this.state.status,
    };
  }

  /** Runs up to `days` days, stopping early once the run resolves. */
  run(days: number): DayReport[] {
    const reports: DayReport[] = [];
    for (let i = 0; i < days && !this.finished; i++) reports.push(this.tick());
    return reports;
  }

  /** Food, rest and the slow cost of keeping people in the field. */
  private upkeep(): void {
    const alive = livingParty(this.state);
    const needed = alive.length * UPKEEP_PER_MEMBER;
    const supplies = this.state.resources["supplies"] ?? 0;

    if (supplies >= needed) {
      addResource(this.state, this.content, "supplies", -needed);
    } else {
      addResource(this.state, this.content, "supplies", -supplies);
      addResource(this.state, this.content, "morale", -STARVATION_MORALE);
      this.log.write(this.state.day, "system", "The stores run dry. The company goes hungry.");
    }

    // Time in the field wears on people; every morale gain has to out-pace this.
    addResource(this.state, this.content, "morale", -MORALE_DRIFT);

    for (const member of alive) {
      member.hp = Math.min(member.maxHp, member.hp + Math.ceil(member.maxHp * REST_FRACTION));
    }
  }

  /** Offers the planner a raid, and resolves it if one is taken. */
  private expedition(dayRng: Rng): void {
    const candidates = availableRaids(this.state, this.content);
    const choice = this.planner(this.state, candidates, this.content);
    if (!choice) return;

    const raid = this.content.raids[choice];
    if (!raid) throw new Error(`Raid planner chose unknown raid "${choice}"`);
    if (!candidates.some((candidate) => candidate.id === raid.id)) {
      throw new Error(`Raid planner chose unavailable raid "${choice}"`);
    }

    const party = readyParty(this.state);
    const result = resolveRaid(
      raid,
      party,
      this.content,
      dayRng.stream(`raid:${raid.id}`),
      { verbose: this.verboseRaids },
    );
    applyRaidResult(result, raid, {
      state: this.state,
      content: this.content,
      rng: dayRng.stream(`raid-aftermath:${raid.id}`),
      log: this.log,
      channel: "raid",
    });
  }

  /** Loss conditions. Victory is content-driven, via the `endRun` effect. */
  private checkEnd(): void {
    if (this.state.status !== "active") return;

    const ctx = {
      state: this.state,
      content: this.content,
      rng: this.rng.stream(`end:${this.state.day}`),
      log: this.log,
      channel: "system" as const,
    };

    if (livingParty(this.state).length === 0) {
      applyEffects(
        [{ kind: "endRun", status: "defeat", reason: "No one is left standing." }],
        ctx,
      );
      return;
    }
    if ((this.state.resources["morale"] ?? 0) <= 0) {
      applyEffects(
        [{ kind: "endRun", status: "defeat", reason: "The company loses heart and scatters." }],
        ctx,
      );
    }
  }
}
