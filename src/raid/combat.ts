import type {
  Ability,
  Content,
  EnemyTemplate,
  LootEntry,
  PartyMember,
  RaidDefinition,
  RaidMechanic,
  RaidOutcome,
  RaidPhase,
  Role,
} from "../core/types";
import type { Rng } from "../core/rng";

export interface Combatant {
  key: string;
  name: string;
  side: "party" | "enemy";
  maxHp: number;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  abilities: Ability[];
  cooldowns: Record<string, number>;
  shield: number;
  /** Temporary attack added by mechanics such as enrage. */
  bonusAttack: number;
  /** Relative likelihood of being targeted by enemies. */
  threat: number;
  memberId?: string;
}

export interface LootRoll {
  id: string;
  name: string;
  resource: string;
  amount: number;
}

export interface RaidResult {
  raidId: string;
  outcome: RaidOutcome;
  rounds: number;
  phasesCleared: number;
  totalPhases: number;
  log: string[];
  /** Final hp of every member who was fielded, keyed by member id. */
  finalHp: Record<string, number>;
  downed: string[];
  loot: LootRoll[];
  damageDealt: number;
  damageTaken: number;
}

/** How much each role draws enemy attention. Vanguards are meant to be hit. */
const THREAT_BY_ROLE: Record<Role, number> = {
  vanguard: 4,
  warden: 2,
  arcanist: 1.5,
  ranger: 1,
};

/** Used when a combatant has no usable ability left this round. */
const BASIC_STRIKE: Ability = {
  id: "basic-strike",
  name: "strike",
  kind: "strike",
  power: 1,
  cooldown: 0,
  priority: 0,
};

const alive = (c: Combatant): boolean => c.hp > 0;

function toCombatant(member: PartyMember, content: Content): Combatant {
  const abilities = member.abilities
    .map((id) => content.abilities[id])
    .filter((ability): ability is Ability => ability !== undefined);

  return {
    key: `party:${member.id}`,
    name: member.name,
    side: "party",
    maxHp: member.maxHp,
    hp: member.hp,
    attack: member.attack,
    defense: member.defense,
    speed: member.speed,
    abilities,
    cooldowns: {},
    shield: 0,
    bonusAttack: 0,
    threat: THREAT_BY_ROLE[member.role],
    memberId: member.id,
  };
}

function spawn(template: EnemyTemplate, index: number, phaseId: string): Combatant {
  const suffix = (template.count ?? 1) > 1 ? ` ${index + 1}` : "";
  return {
    key: `enemy:${phaseId}:${template.id}:${index}`,
    name: `${template.name}${suffix}`,
    side: "enemy",
    maxHp: template.hp,
    hp: template.hp,
    attack: template.attack,
    defense: template.defense,
    speed: template.speed,
    abilities: [],
    cooldowns: {},
    shield: 0,
    bonusAttack: 0,
    threat: 1,
  };
}

function buildEnemies(phase: RaidPhase): Combatant[] {
  const out: Combatant[] = [];
  for (const template of phase.enemies) {
    const count = Math.max(1, template.count ?? 1);
    for (let i = 0; i < count; i++) out.push(spawn(template, i, phase.id));
  }
  return out;
}

/** Damage after variance and the defender's mitigation; never below 1. */
function damageRoll(attacker: Combatant, defender: Combatant, power: number, rng: Rng): number {
  const variance = rng.float(0.9, 1.1);
  const raw = (attacker.attack + attacker.bonusAttack) * power * variance;
  return Math.max(1, Math.round(raw - defender.defense / 2));
}

/** Applies damage through any shield first. Returns hp actually lost. */
function applyDamage(target: Combatant, amount: number): number {
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  const toHp = amount - absorbed;
  const before = target.hp;
  target.hp = Math.max(0, target.hp - toHp);
  return before - target.hp;
}

function lowestHp(candidates: Combatant[]): Combatant | undefined {
  let best: Combatant | undefined;
  for (const c of candidates) {
    if (!best || c.hp / c.maxHp < best.hp / best.maxHp) best = c;
  }
  return best;
}

/**
 * Picks the ability a party member uses this round. The AI is intentionally
 * simple and fully deterministic: healing and shielding react to how hurt the
 * group is, area damage needs a crowd, and everything else falls back to a
 * plain strike.
 */
function selectAbility(actor: Combatant, allies: Combatant[], enemies: Combatant[]): Ability {
  const ready = actor.abilities
    .filter((ability) => (actor.cooldowns[ability.id] ?? 0) <= 0)
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));

  const hurt = allies.filter((ally) => ally.hp / ally.maxHp < 0.55);
  for (const ability of ready) {
    switch (ability.kind) {
      case "mend":
        if (hurt.length > 0) return ability;
        break;
      case "guard":
        if (allies.some((ally) => ally.hp / ally.maxHp < 0.7)) return ability;
        break;
      case "volley":
        if (enemies.length >= 2) return ability;
        break;
      case "strike":
        return ability;
    }
  }
  return ready.find((ability) => ability.kind === "strike") ?? BASIC_STRIKE;
}

interface RoundContext {
  rng: Rng;
  log: string[];
  verbose: boolean;
}

function act(
  actor: Combatant,
  allies: Combatant[],
  foes: Combatant[],
  ctx: RoundContext,
): { dealt: number } {
  const livingFoes = foes.filter(alive);
  const livingAllies = allies.filter(alive);
  if (livingFoes.length === 0) return { dealt: 0 };

  if (actor.side === "enemy") {
    const target = ctx.rng.weighted(livingFoes, (c) => c.threat) ?? livingFoes[0]!;
    const dealt = applyDamage(target, damageRoll(actor, target, 1, ctx.rng));
    if (ctx.verbose) ctx.log.push(`${actor.name} hits ${target.name} for ${dealt}.`);
    if (!alive(target)) ctx.log.push(`${target.name} goes down.`);
    return { dealt };
  }

  const ability = selectAbility(actor, livingAllies, livingFoes);
  if (ability.cooldown > 0) actor.cooldowns[ability.id] = ability.cooldown;

  switch (ability.kind) {
    case "mend": {
      const target = lowestHp(livingAllies) ?? actor;
      const amount = Math.round(ability.power * (1 + actor.attack / 25));
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + amount);
      if (ctx.verbose) {
        ctx.log.push(`${actor.name} mends ${target.name} for ${target.hp - before}.`);
      }
      return { dealt: 0 };
    }
    case "guard": {
      const target = lowestHp(livingAllies) ?? actor;
      const amount = Math.round(ability.power * (1 + actor.defense / 10));
      target.shield += amount;
      if (ctx.verbose) ctx.log.push(`${actor.name} shields ${target.name} for ${amount}.`);
      return { dealt: 0 };
    }
    case "volley": {
      let dealt = 0;
      for (const foe of livingFoes) {
        dealt += applyDamage(foe, damageRoll(actor, foe, ability.power, ctx.rng));
        if (!alive(foe)) ctx.log.push(`${foe.name} is slain.`);
      }
      if (ctx.verbose) ctx.log.push(`${actor.name} looses ${ability.name} for ${dealt}.`);
      return { dealt };
    }
    case "strike":
    default: {
      // Focus fire: finishing wounded enemies removes their damage soonest.
      const target = lowestHp(livingFoes) ?? livingFoes[0]!;
      const dealt = applyDamage(target, damageRoll(actor, target, ability.power, ctx.rng));
      if (ctx.verbose) ctx.log.push(`${actor.name} strikes ${target.name} for ${dealt}.`);
      if (!alive(target)) ctx.log.push(`${target.name} is slain.`);
      return { dealt };
    }
  }
}

function applyMechanics(
  mechanics: RaidMechanic[] | undefined,
  phase: RaidPhase,
  roundInPhase: number,
  party: Combatant[],
  enemies: Combatant[],
  ctx: RoundContext,
): number {
  if (!mechanics) return 0;
  let taken = 0;

  for (const mechanic of mechanics) {
    switch (mechanic.kind) {
      case "enrage": {
        if (roundInPhase <= mechanic.afterRound) break;
        for (const enemy of enemies.filter(alive)) enemy.bonusAttack += mechanic.attackBonus;
        if (roundInPhase === mechanic.afterRound + 1) {
          ctx.log.push(`The ${phase.name} enrages!`);
        }
        break;
      }
      case "aoe": {
        if (roundInPhase % mechanic.everyRounds !== 0) break;
        ctx.log.push(`${mechanic.name ?? "A wave of force"} sweeps the party.`);
        for (const member of party.filter(alive)) {
          taken += applyDamage(member, mechanic.damage);
          if (!alive(member)) ctx.log.push(`${member.name} goes down.`);
        }
        break;
      }
      case "shield": {
        if (roundInPhase % mechanic.everyRounds !== 0) break;
        for (const enemy of enemies.filter(alive)) enemy.shield += mechanic.amount;
        ctx.log.push(`${mechanic.name ?? "A ward"} hardens the enemy.`);
        break;
      }
      case "adds": {
        if (roundInPhase % mechanic.everyRounds !== 0) break;
        const count = Math.max(1, mechanic.template.count ?? 1);
        for (let i = 0; i < count; i++) {
          enemies.push(spawn(mechanic.template, enemies.length + i, phase.id));
        }
        ctx.log.push(`${mechanic.name ?? "Reinforcements"} arrive.`);
        break;
      }
    }
  }
  return taken;
}

export interface ResolveRaidOptions {
  /** Include per-action lines in the raid log. Off by default; fights are long. */
  verbose?: boolean;
}

function rollLoot(entries: LootEntry[], rolls: number, rng: Rng): LootRoll[] {
  const out: LootRoll[] = [];
  for (let i = 0; i < rolls; i++) {
    const entry = rng.weighted(entries, (e) => e.weight);
    if (!entry) break;
    const [min, max] = entry.amount;
    out.push({
      id: entry.id,
      name: entry.name,
      resource: entry.resource,
      amount: rng.int(Math.min(min, max), Math.max(min, max)),
    });
  }
  return out;
}

/**
 * Runs a raid to completion. Pure with respect to world state: it reads the
 * fielded members and returns what happened, leaving persistence to the caller.
 */
export function resolveRaid(
  raid: RaidDefinition,
  members: PartyMember[],
  content: Content,
  rng: Rng,
  options: ResolveRaidOptions = {},
): RaidResult {
  const log: string[] = [];
  const ctx: RoundContext = { rng, log, verbose: options.verbose ?? false };
  const party = members.map((member) => toCombatant(member, content));

  const result: RaidResult = {
    raidId: raid.id,
    outcome: "wipe",
    rounds: 0,
    phasesCleared: 0,
    totalPhases: raid.phases.length,
    log,
    finalHp: {},
    downed: [],
    loot: [],
    damageDealt: 0,
    damageTaken: 0,
  };

  if (party.length === 0) {
    log.push("No one is fit to march. The raid is called off.");
    result.outcome = "retreat";
    return result;
  }

  log.push(`The company assaults ${raid.name}.`);
  let outcome: RaidOutcome = "victory";

  phases: for (const phase of raid.phases) {
    const enemies = buildEnemies(phase);
    log.push(`— ${phase.name} —`);
    let roundInPhase = 0;

    while (enemies.some(alive) && party.some(alive)) {
      if (result.rounds >= raid.maxRounds) {
        log.push("The company is spent and withdraws.");
        outcome = "retreat";
        break phases;
      }
      result.rounds++;
      roundInPhase++;

      result.damageTaken += applyMechanics(
        phase.mechanics,
        phase,
        roundInPhase,
        party,
        enemies,
        ctx,
      );
      if (!party.some(alive)) break;

      // Fastest first; the key breaks ties so ordering never depends on
      // array order or object identity.
      const order = [...party, ...enemies]
        .filter(alive)
        .sort((a, b) => b.speed - a.speed || (a.key < b.key ? -1 : 1));

      for (const actor of order) {
        if (!alive(actor)) continue;
        if (!party.some(alive) || !enemies.some(alive)) break;
        const isParty = actor.side === "party";
        const before = isParty ? 0 : party.reduce((sum, c) => sum + c.hp, 0);
        const { dealt } = act(actor, isParty ? party : enemies, isParty ? enemies : party, ctx);
        if (isParty) {
          result.damageDealt += dealt;
        } else {
          result.damageTaken += before - party.reduce((sum, c) => sum + c.hp, 0);
        }
      }

      for (const combatant of party) {
        for (const id of Object.keys(combatant.cooldowns)) {
          combatant.cooldowns[id] = Math.max(0, (combatant.cooldowns[id] ?? 0) - 1);
        }
      }
    }

    if (!party.some(alive)) {
      log.push("The company is broken.");
      outcome = "wipe";
      break;
    }
    result.phasesCleared++;
    log.push(`${phase.name} is cleared.`);
  }

  result.outcome = outcome;
  for (const combatant of party) {
    if (combatant.memberId === undefined) continue;
    result.finalHp[combatant.memberId] = combatant.hp;
    if (combatant.hp <= 0) result.downed.push(combatant.memberId);
  }

  if (outcome === "victory") {
    log.push(`${raid.name} falls to the company.`);
    result.loot = rollLoot(raid.loot, raid.lootRolls, rng.stream(`loot:${raid.id}`));
  }
  return result;
}
