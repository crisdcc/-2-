import type { CompareOp, Condition, WorldState } from "./types";
import { livingParty, partyPower } from "./state";

export function compare(left: number, op: CompareOp, right: number): boolean {
  switch (op) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">=":
      return left >= right;
    case ">":
      return left > right;
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown comparison operator: ${String(exhaustive)}`);
    }
  }
}

/**
 * Evaluates a condition against world state. Conditions are deliberately pure
 * and randomness-free: the same state always gives the same answer, which is
 * what makes content gating testable.
 */
export function evaluate(condition: Condition | undefined, state: WorldState): boolean {
  if (!condition) return true;

  switch (condition.kind) {
    case "always":
      return true;
    case "never":
      return false;
    case "flag":
      return (state.flags[condition.flag] ?? false) === (condition.value ?? true);
    case "resource":
      return compare(state.resources[condition.resource] ?? 0, condition.op, condition.value);
    case "day":
      return compare(state.day, condition.op, condition.value);
    case "partySize":
      return compare(livingParty(state).length, condition.op, condition.value);
    case "partyHasRole":
      return livingParty(state).some((member) => member.role === condition.role);
    case "partyPower":
      return compare(partyPower(state), condition.op, condition.value);
    case "arcStarted":
      return state.arcs[condition.arc] !== undefined;
    case "arcStage": {
      const arc = state.arcs[condition.arc];
      return arc !== undefined && !arc.completed && arc.stage === condition.stage;
    }
    case "arcCompleted": {
      const arc = state.arcs[condition.arc];
      if (!arc || !arc.completed) return false;
      return condition.outcome === undefined || arc.outcome === condition.outcome;
    }
    case "eventFired": {
      const record = state.events[condition.event];
      const count = record?.count ?? 0;
      // Bare `eventFired` means "at least once".
      if (condition.op === undefined || condition.value === undefined) return count > 0;
      return compare(count, condition.op, condition.value);
    }
    case "raidUnlocked":
      return state.unlockedRaids.includes(condition.raid);
    case "raidCleared":
      return state.clearedRaids.includes(condition.raid);
    case "not":
      return !evaluate(condition.of, state);
    case "all":
      return condition.of.every((sub) => evaluate(sub, state));
    case "any":
      return condition.of.some((sub) => evaluate(sub, state));
    default: {
      const exhaustive: never = condition;
      throw new Error(`Unknown condition kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Human-readable rendering of a condition, for logs and debugging output. */
export function describeCondition(condition: Condition | undefined): string {
  if (!condition) return "no requirement";

  switch (condition.kind) {
    case "always":
      return "always";
    case "never":
      return "never";
    case "flag":
      return `${condition.flag} is ${condition.value ?? true}`;
    case "resource":
      return `${condition.resource} ${condition.op} ${condition.value}`;
    case "day":
      return `day ${condition.op} ${condition.value}`;
    case "partySize":
      return `party size ${condition.op} ${condition.value}`;
    case "partyHasRole":
      return `party includes a ${condition.role}`;
    case "partyPower":
      return `party power ${condition.op} ${condition.value}`;
    case "arcStarted":
      return `arc "${condition.arc}" started`;
    case "arcStage":
      return `arc "${condition.arc}" at stage "${condition.stage}"`;
    case "arcCompleted":
      return condition.outcome
        ? `arc "${condition.arc}" completed as "${condition.outcome}"`
        : `arc "${condition.arc}" completed`;
    case "eventFired":
      return condition.op !== undefined && condition.value !== undefined
        ? `event "${condition.event}" fired ${condition.op} ${condition.value} times`
        : `event "${condition.event}" has fired`;
    case "raidUnlocked":
      return `raid "${condition.raid}" unlocked`;
    case "raidCleared":
      return `raid "${condition.raid}" cleared`;
    case "not":
      return `not (${describeCondition(condition.of)})`;
    case "all":
      return condition.of.length === 0
        ? "always"
        : `(${condition.of.map(describeCondition).join(" and ")})`;
    case "any":
      return condition.of.length === 0
        ? "never"
        : `(${condition.of.map(describeCondition).join(" or ")})`;
    default: {
      const exhaustive: never = condition;
      throw new Error(`Unknown condition kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
