import type {
  Arc,
  ArcState,
  Choice,
  Content,
  PendingChoice,
  Stage,
  WorldState,
} from "../core/types";
import type { Rng } from "../core/rng";
import type { GameLog } from "../core/log";
import { evaluate } from "../core/conditions";
import { applyEffects } from "../core/effects";

/**
 * Decides which option to take when an arc reaches a branching stage. Only
 * options flagged `available` may be returned; anything else falls back to the
 * first available option.
 */
export type ChoiceStrategy = (prompt: PendingChoice, state: WorldState, rng: Rng) => string;

/** Always takes the topmost option the player is allowed to take. */
export const firstAvailable: ChoiceStrategy = (prompt) =>
  prompt.options.find((option) => option.available)!.id;

/** Picks uniformly among available options. */
export const randomChoice: ChoiceStrategy = (prompt, _state, rng) =>
  rng.pick(prompt.options.filter((option) => option.available)).id;

/**
 * Replays a fixed script: keys are `arcId` or `arcId:stageId`, values are the
 * choice id to take. Falls back to `fallback` for anything unscripted.
 */
export function scripted(
  script: Record<string, string>,
  fallback: ChoiceStrategy = firstAvailable,
): ChoiceStrategy {
  return (prompt, state, rng) => {
    const exact = script[`${prompt.arcId}:${prompt.stageId}`];
    const byArc = script[prompt.arcId];
    const wanted = exact ?? byArc;
    if (wanted && prompt.options.some((o) => o.id === wanted && o.available)) return wanted;
    return fallback(prompt, state, rng);
  };
}

/** Guards against content that loops between stages without ever settling. */
const MAX_STEPS_PER_ARC = 32;

export class NarrativeEngine {
  constructor(private readonly content: Content) {}

  /** Arcs that have begun and not yet finished. */
  activeArcs(state: WorldState): ArcState[] {
    return Object.values(state.arcs).filter((arc) => !arc.completed);
  }

  /** Starts any arc whose `autoStart` condition has just become true. */
  private startEligibleArcs(state: WorldState, log: GameLog): void {
    for (const arc of Object.values(this.content.arcs)) {
      if (!arc.autoStart) continue;
      if (state.arcs[arc.id]) continue;
      if (!evaluate(arc.autoStart, state)) continue;
      state.arcs[arc.id] = {
        arcId: arc.id,
        stage: arc.start,
        startedDay: state.day,
        completed: false,
        history: [],
      };
      log.write(state.day, "narrative", `A new thread begins: ${arc.title}`);
    }
  }

  tick(state: WorldState, rng: Rng, log: GameLog, chooser: ChoiceStrategy): void {
    if (state.status !== "active") return;
    this.startEligibleArcs(state, log);

    // Sorted for determinism: object key order must not steer the simulation.
    const ids = Object.keys(state.arcs).sort();
    for (const id of ids) {
      const arcState = state.arcs[id];
      if (!arcState || arcState.completed) continue;
      this.advance(arcState, state, rng, log, chooser);
    }
  }

  /** Runs one arc forward until it blocks, branches out, or finishes. */
  private advance(
    arcState: ArcState,
    state: WorldState,
    rng: Rng,
    log: GameLog,
    chooser: ChoiceStrategy,
  ): void {
    const arc = this.content.arcs[arcState.arcId];
    if (!arc) throw new Error(`NarrativeEngine: unknown arc "${arcState.arcId}"`);

    for (let step = 0; step < MAX_STEPS_PER_ARC; step++) {
      if (arcState.completed) return;

      const stage = arc.stages[arcState.stage];
      if (!stage) {
        throw new Error(`Arc "${arc.id}" has no stage "${arcState.stage}"`);
      }

      // The run can end part-way through a tick (an `endRun` effect inside a
      // choice, say). An arc sitting on a terminal stage still gets to close
      // out so the record is coherent, but nothing new is started.
      if (state.status !== "active") {
        if (!stage.terminal) return;
        if (arcState.history[arcState.history.length - 1] !== stage.id) {
          arcState.history.push(stage.id);
          log.write(state.day, "narrative", `[${arc.title}] ${stage.text}`);
        }
        arcState.completed = true;
        if (stage.outcome !== undefined) arcState.outcome = stage.outcome;
        return;
      }

      // Entering a stage for the first time: narrate it and run its effects.
      // Those effects may themselves move the arc, so we restart the loop.
      if (arcState.history[arcState.history.length - 1] !== stage.id) {
        arcState.history.push(stage.id);
        log.write(state.day, "narrative", `[${arc.title}] ${stage.text}`);
        applyEffects(stage.onEnter, {
          state,
          content: this.content,
          rng: rng.stream(`arc:${arc.id}:${stage.id}:enter`),
          log,
          channel: "narrative",
        });
        continue;
      }

      if (stage.terminal) {
        arcState.completed = true;
        if (stage.outcome !== undefined) arcState.outcome = stage.outcome;
        log.write(
          state.day,
          "narrative",
          `[${arc.title}] concludes${stage.outcome ? ` — ${stage.outcome}` : ""}.`,
        );
        return;
      }

      if (stage.choices && stage.choices.length > 0) {
        const resolved = this.resolveChoice(arc, stage, stage.choices, state, rng, log, chooser);
        // No option is currently open: fall through to transitions instead of
        // deadlocking, so world state can still unblock the arc later.
        if (resolved) continue;
      }

      const next = stage.transitions?.find((transition) => evaluate(transition.requires, state));
      if (!next) return; // The arc waits for the world to change.
      if (!arc.stages[next.goto]) {
        throw new Error(`Arc "${arc.id}": transition targets missing stage "${next.goto}"`);
      }
      arcState.stage = next.goto;
    }

    throw new Error(
      `Arc "${arc.id}" did not settle within ${MAX_STEPS_PER_ARC} steps — check for a stage cycle`,
    );
  }

  /** Builds the prompt, asks the strategy, and applies the taken option. */
  private resolveChoice(
    arc: Arc,
    stage: Stage,
    choices: Choice[],
    state: WorldState,
    rng: Rng,
    log: GameLog,
    chooser: ChoiceStrategy,
  ): boolean {
    const prompt: PendingChoice = {
      arcId: arc.id,
      stageId: stage.id,
      prompt: stage.text,
      options: choices.map((choice) => ({
        id: choice.id,
        text: choice.text,
        available: evaluate(choice.requires, state),
      })),
    };
    if (!prompt.options.some((option) => option.available)) return false;

    const chooserRng = rng.stream(`arc:${arc.id}:${stage.id}:choice`);
    const wanted = chooser(prompt, state, chooserRng);
    const picked =
      choices.find((choice) => choice.id === wanted && evaluate(choice.requires, state)) ??
      choices.find((choice) => evaluate(choice.requires, state))!;

    log.write(state.day, "choice", `[${arc.title}] ${picked.text}`);
    applyEffects(picked.effects, {
      state,
      content: this.content,
      rng: rng.stream(`arc:${arc.id}:${stage.id}:${picked.id}`),
      log,
      channel: "choice",
    });

    if (picked.goto) {
      if (!arc.stages[picked.goto]) {
        throw new Error(`Arc "${arc.id}": choice "${picked.id}" targets missing stage "${picked.goto}"`);
      }
      // A choice effect may already have moved or finished the arc; respect that.
      const current = state.arcs[arc.id];
      if (current && !current.completed && current.stage === stage.id) {
        current.stage = picked.goto;
      }
    }
    return true;
  }
}
