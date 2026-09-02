import type { Content, Effect, PartyMember } from "../core/types";

/**
 * Static checks over a content bundle. Content is data, so typos in an arc id
 * or a loot resource would otherwise only surface as a mid-run exception —
 * this turns them into one report at construction time.
 */
export function validateContent(content: Content): string[] {
  const problems: string[] = [];
  const resourceIds = new Set(content.resources.map((def) => def.id));
  const eventIds = new Set<string>();
  const abilityIds = new Set(Object.keys(content.abilities));
  const memberIds = new Set(
    [...content.startingParty, ...content.reserves].map((member) => member.id),
  );

  /** `scheduleEvent` may reference an event declared later; checked in a second pass. */
  const pendingEventRefs: [string, string][] = [];

  const checkEffects = (effects: Effect[] | undefined, where: string): void => {
    for (const effect of effects ?? []) {
      switch (effect.kind) {
        case "resource":
          if (!resourceIds.has(effect.resource)) {
            problems.push(`${where}: unknown resource "${effect.resource}"`);
          }
          break;
        case "startArc":
        case "advanceArc":
        case "completeArc":
          if (!content.arcs[effect.arc]) problems.push(`${where}: unknown arc "${effect.arc}"`);
          else if (effect.kind === "advanceArc" && !content.arcs[effect.arc]!.stages[effect.stage]) {
            problems.push(`${where}: arc "${effect.arc}" has no stage "${effect.stage}"`);
          }
          break;
        case "unlockRaid":
          if (!content.raids[effect.raid]) problems.push(`${where}: unknown raid "${effect.raid}"`);
          break;
        case "scheduleEvent":
          pendingEventRefs.push([effect.event, where]);
          break;
        case "recruit":
          if (effect.member && !memberIds.has(effect.member)) {
            problems.push(`${where}: unknown recruit "${effect.member}"`);
          }
          break;
        default:
          break;
      }
    }
  };

  const checkMember = (member: PartyMember, where: string): void => {
    if (member.maxHp <= 0) problems.push(`${where}: "${member.id}" has non-positive maxHp`);
    for (const id of member.abilities) {
      if (!abilityIds.has(id)) problems.push(`${where}: "${member.id}" uses unknown ability "${id}"`);
    }
  };

  for (const member of content.startingParty) checkMember(member, "startingParty");
  for (const member of content.reserves) checkMember(member, "reserves");

  for (const event of content.events) {
    if (eventIds.has(event.id)) problems.push(`events: duplicate id "${event.id}"`);
    eventIds.add(event.id);
    if (event.weight < 0) problems.push(`event "${event.id}": negative weight`);
    checkEffects(event.effects, `event "${event.id}"`);
  }

  for (const [arcId, arc] of Object.entries(content.arcs)) {
    if (arc.id !== arcId) problems.push(`arcs: key "${arcId}" does not match arc id "${arc.id}"`);
    if (!arc.stages[arc.start]) problems.push(`arc "${arc.id}": missing start stage "${arc.start}"`);

    for (const [stageId, stage] of Object.entries(arc.stages)) {
      const where = `arc "${arc.id}" stage "${stageId}"`;
      if (stage.id !== stageId) problems.push(`${where}: id mismatch ("${stage.id}")`);
      checkEffects(stage.onEnter, where);

      for (const transition of stage.transitions ?? []) {
        if (!arc.stages[transition.goto]) {
          problems.push(`${where}: transition to missing stage "${transition.goto}"`);
        }
      }
      for (const choice of stage.choices ?? []) {
        checkEffects(choice.effects, `${where} choice "${choice.id}"`);
        if (choice.goto && !arc.stages[choice.goto]) {
          problems.push(`${where}: choice "${choice.id}" targets missing stage "${choice.goto}"`);
        }
      }
      const isDeadEnd =
        !stage.terminal && !stage.transitions?.length && !stage.choices?.length;
      if (isDeadEnd) problems.push(`${where}: no transitions, no choices and not terminal`);
    }
  }

  for (const [raidId, raid] of Object.entries(content.raids)) {
    const where = `raid "${raidId}"`;
    if (raid.id !== raidId) problems.push(`raids: key "${raidId}" does not match raid id "${raid.id}"`);
    if (raid.phases.length === 0) problems.push(`${where}: no phases`);
    if (raid.maxRounds <= 0) problems.push(`${where}: maxRounds must be positive`);
    for (const phase of raid.phases) {
      if (phase.enemies.length === 0) problems.push(`${where} phase "${phase.id}": no enemies`);
    }
    for (const entry of raid.loot) {
      if (!resourceIds.has(entry.resource)) {
        problems.push(`${where} loot "${entry.id}": unknown resource "${entry.resource}"`);
      }
    }
    checkEffects(raid.onVictory, `${where} onVictory`);
    checkEffects(raid.onDefeat, `${where} onDefeat`);
  }

  for (const [eventId, where] of pendingEventRefs) {
    if (!eventIds.has(eventId)) problems.push(`${where}: schedules unknown event "${eventId}"`);
  }

  return problems;
}

export function assertValidContent(content: Content): void {
  const problems = validateContent(content);
  if (problems.length > 0) {
    throw new Error(`Invalid content:\n  - ${problems.join("\n  - ")}`);
  }
}
