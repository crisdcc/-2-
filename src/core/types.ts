/**
 * The complete domain schema for the chronicle engine.
 *
 * Every type lives here on purpose: content (events, arcs, raids) is plain
 * data, and the behaviour modules that interpret it (`events/`, `narrative/`,
 * `raid/`) all depend on these declarations without depending on each other.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type CompareOp = "<" | "<=" | "==" | "!=" | ">=" | ">";

export type ResourceId = string;

export interface ResourceDef {
  id: ResourceId;
  name: string;
  min: number;
  max: number;
  initial: number;
}

export type Role = "vanguard" | "ranger" | "warden" | "arcanist";

export interface Ability {
  id: string;
  name: string;
  kind: "strike" | "volley" | "mend" | "guard";
  /** Multiplier on the user's attack for damage abilities, flat value otherwise. */
  power: number;
  /** Rounds to wait between uses. 0 means it is always ready. */
  cooldown: number;
  /** Higher priority abilities are considered first by the combat AI. */
  priority: number;
}

export interface PartyMember {
  id: string;
  name: string;
  role: Role;
  level: number;
  maxHp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  abilities: string[];
  /** Day index up to and including which this member cannot raid. */
  injuredUntil: number;
}

// ---------------------------------------------------------------------------
// Conditions — pure predicates over world state, never random
// ---------------------------------------------------------------------------

export type Condition =
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "flag"; flag: string; value?: boolean }
  | { kind: "resource"; resource: ResourceId; op: CompareOp; value: number }
  | { kind: "day"; op: CompareOp; value: number }
  | { kind: "partySize"; op: CompareOp; value: number }
  | { kind: "partyHasRole"; role: Role }
  | { kind: "partyPower"; op: CompareOp; value: number }
  | { kind: "arcStarted"; arc: string }
  | { kind: "arcStage"; arc: string; stage: string }
  | { kind: "arcCompleted"; arc: string; outcome?: string }
  | { kind: "eventFired"; event: string; op?: CompareOp; value?: number }
  | { kind: "raidUnlocked"; raid: string }
  | { kind: "raidCleared"; raid: string }
  | { kind: "not"; of: Condition }
  | { kind: "all"; of: Condition[] }
  | { kind: "any"; of: Condition[] };

// ---------------------------------------------------------------------------
// Effects — the only sanctioned way to mutate the world
// ---------------------------------------------------------------------------

export type TargetSelector = "party" | "lowestHp" | "random" | "leader";

export type Effect =
  | { kind: "resource"; resource: ResourceId; delta: number }
  | { kind: "setFlag"; flag: string; value?: boolean }
  | { kind: "startArc"; arc: string }
  | { kind: "advanceArc"; arc: string; stage: string }
  | { kind: "completeArc"; arc: string; outcome?: string }
  | { kind: "heal"; amount: number; target: TargetSelector }
  | { kind: "damage"; amount: number; target: TargetSelector }
  | { kind: "injure"; days: number; target: TargetSelector }
  | { kind: "recruit"; member?: string }
  | { kind: "unlockRaid"; raid: string }
  | { kind: "scheduleEvent"; event: string; inDays: number }
  | { kind: "endRun"; status: "victory" | "defeat"; reason: string }
  | { kind: "log"; message: string };

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventCategory = "world" | "company" | "omen";

export interface GameEvent {
  id: string;
  title: string;
  category: EventCategory;
  /** Relative selection weight within its priority tier. Must be > 0. */
  weight: number;
  /** Events in the highest eligible tier crowd out every lower tier. */
  priority?: number;
  requires?: Condition;
  /** Minimum days between two firings of this event. */
  cooldownDays?: number;
  /** Hard cap on total firings; 1 makes the event a one-shot. */
  maxFires?: number;
  narration: string;
  effects?: Effect[];
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

export interface Choice {
  id: string;
  text: string;
  requires?: Condition;
  effects?: Effect[];
  goto?: string;
}

export interface Transition {
  requires: Condition;
  goto: string;
}

export interface Stage {
  id: string;
  text: string;
  onEnter?: Effect[];
  /** A stage with choices blocks the arc until one is resolved. */
  choices?: Choice[];
  /** Evaluated in order; the first matching transition wins. */
  transitions?: Transition[];
  terminal?: boolean;
  outcome?: string;
}

export interface Arc {
  id: string;
  title: string;
  summary: string;
  start: string;
  /** When true and the arc has never run, it begins on its own. */
  autoStart?: Condition;
  stages: Record<string, Stage>;
}

// ---------------------------------------------------------------------------
// Raids
// ---------------------------------------------------------------------------

export interface EnemyTemplate {
  id: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  count?: number;
}

export type RaidMechanic =
  | { kind: "enrage"; afterRound: number; attackBonus: number }
  | { kind: "aoe"; everyRounds: number; damage: number; name?: string }
  | { kind: "shield"; everyRounds: number; amount: number; name?: string }
  | { kind: "adds"; everyRounds: number; template: EnemyTemplate; name?: string };

export interface RaidPhase {
  id: string;
  name: string;
  enemies: EnemyTemplate[];
  mechanics?: RaidMechanic[];
}

export interface LootEntry {
  id: string;
  name: string;
  weight: number;
  resource: ResourceId;
  amount: [number, number];
}

export interface RaidDefinition {
  id: string;
  name: string;
  tier: number;
  requires?: Condition;
  phases: RaidPhase[];
  /** Total round budget across all phases; running out is a retreat. */
  maxRounds: number;
  loot: LootEntry[];
  lootRolls: number;
  onVictory?: Effect[];
  onDefeat?: Effect[];
}

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

export interface ArcState {
  arcId: string;
  stage: string;
  startedDay: number;
  completed: boolean;
  outcome?: string;
  /** Every stage entered, in order. */
  history: string[];
}

export interface EventRecord {
  count: number;
  lastDay: number;
}

export interface RaidRecord {
  day: number;
  raidId: string;
  outcome: RaidOutcome;
  rounds: number;
}

export type RaidOutcome = "victory" | "retreat" | "wipe";

export interface ChoiceOption {
  id: string;
  text: string;
  available: boolean;
  /** Readable rendering of the gate, present only when the option has one. */
  requirement?: string;
}

export interface PendingChoice {
  arcId: string;
  stageId: string;
  prompt: string;
  options: ChoiceOption[];
}

export type RunStatus = "active" | "victory" | "defeat";

export interface WorldState {
  seed: string;
  day: number;
  resources: Record<ResourceId, number>;
  flags: Record<string, boolean>;
  party: PartyMember[];
  reserves: string[];
  arcs: Record<string, ArcState>;
  events: Record<string, EventRecord>;
  scheduled: { eventId: string; day: number }[];
  unlockedRaids: string[];
  clearedRaids: string[];
  raids: RaidRecord[];
  lastRaidDay: number;
  status: RunStatus;
  statusReason?: string;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogChannel = "system" | "event" | "narrative" | "choice" | "raid" | "loot";

export interface LogEntry {
  day: number;
  channel: LogChannel;
  message: string;
}

// ---------------------------------------------------------------------------
// Content bundle
// ---------------------------------------------------------------------------

export interface Content {
  resources: ResourceDef[];
  abilities: Record<string, Ability>;
  events: GameEvent[];
  arcs: Record<string, Arc>;
  raids: Record<string, RaidDefinition>;
  startingParty: PartyMember[];
  reserves: PartyMember[];
}
