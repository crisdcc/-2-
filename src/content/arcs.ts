import type { Arc } from "../core/types";

/**
 * The spine of a run. Arcs are state machines: stages narrate, `onEnter`
 * effects change the world, transitions fire automatically when the world
 * agrees, and choice stages hand the decision to a strategy.
 */
export const compact: Arc = {
  id: "compact",
  title: "The Warden's Compact",
  summary: "An old pact wants renewing, and the marches will not wait.",
  start: "summons",
  autoStart: { kind: "day", op: ">=", value: 3 },
  stages: {
    summons: {
      id: "summons",
      text: "A sealed summons names the company by an older name than it uses now.",
      transitions: [{ requires: { kind: "day", op: ">=", value: 6 }, goto: "council" }],
    },
    council: {
      id: "council",
      text: "The wardens' council will hear the company once.",
      choices: [
        {
          id: "bargain",
          text: "Buy the council's maps outright.",
          requires: { kind: "resource", resource: "gold", op: ">=", value: 80 },
          effects: [
            { kind: "resource", resource: "gold", delta: -80 },
            { kind: "resource", resource: "intel", delta: 15 },
          ],
          goto: "muster",
        },
        {
          id: "pledge",
          text: "Pledge the company to the compact.",
          effects: [
            { kind: "resource", resource: "morale", delta: 5 },
            { kind: "resource", resource: "renown", delta: 6 },
            { kind: "setFlag", flag: "pledged" },
          ],
          goto: "muster",
        },
        {
          id: "refuse",
          text: "Refuse, and keep the company's own counsel.",
          requires: { kind: "flag", flag: "omen-seen", value: false },
          effects: [
            { kind: "resource", resource: "morale", delta: -5 },
            { kind: "resource", resource: "renown", delta: -5 },
          ],
          goto: "alone",
        },
      ],
    },
    muster: {
      id: "muster",
      text: "The compact is spoken. The barrow road is opened to the company.",
      onEnter: [{ kind: "unlockRaid", raid: "ashen-barrow" }],
      transitions: [{ requires: { kind: "raidCleared", raid: "ashen-barrow" }, goto: "deeper" }],
    },
    alone: {
      id: "alone",
      text: "No pact, no escort. The barrow road is walked alone.",
      onEnter: [
        { kind: "unlockRaid", raid: "ashen-barrow" },
        { kind: "resource", resource: "morale", delta: -2 },
      ],
      transitions: [{ requires: { kind: "raidCleared", raid: "ashen-barrow" }, goto: "deeper" }],
    },
    deeper: {
      id: "deeper",
      text: "Whatever was in the cairn was only keeping a door. The Ember Hold is the door.",
      onEnter: [
        { kind: "unlockRaid", raid: "ember-hold" },
        { kind: "resource", resource: "renown", delta: 8 },
      ],
      transitions: [{ requires: { kind: "raidCleared", raid: "ember-hold" }, goto: "sealing" }],
    },
    sealing: {
      id: "sealing",
      text: "The hold is taken. Sealing it needs knowledge the company does not yet hold.",
      transitions: [{ requires: { kind: "resource", resource: "intel", op: ">=", value: 45 }, goto: "rite" }],
    },
    rite: {
      id: "rite",
      text: "Everything needed for the rite is finally in hand.",
      choices: [
        {
          id: "seal",
          text: "Speak the rite and close the hold for good.",
          requires: { kind: "resource", resource: "intel", op: ">=", value: 45 },
          effects: [
            { kind: "resource", resource: "intel", delta: -45 },
            { kind: "resource", resource: "renown", delta: 20 },
            { kind: "endRun", status: "victory", reason: "The Ember Hold is sealed. The compact holds." },
          ],
          goto: "sealed",
        },
        {
          id: "hold",
          text: "Leave it open, and keep the watch instead.",
          effects: [
            { kind: "resource", resource: "morale", delta: -4 },
            { kind: "resource", resource: "renown", delta: 10 },
          ],
          goto: "vigil",
        },
      ],
    },
    sealed: {
      id: "sealed",
      text: "The stone goes quiet.",
      terminal: true,
      outcome: "sealed",
    },
    vigil: {
      id: "vigil",
      text: "The company settles in for a watch with no end written into it.",
      terminal: true,
      outcome: "vigil",
    },
  },
};

export const marches: Arc = {
  id: "marches",
  title: "Mapping the Ember Marches",
  summary: "Rumours of the country ahead, worth chasing down.",
  autoStart: { kind: "eventFired", event: "scout-report", op: ">=", value: 2 },
  start: "rumor",
  stages: {
    rumor: {
      id: "rumor",
      text: "The scouts keep circling the same burnt valley on the map.",
      transitions: [{ requires: { kind: "resource", resource: "intel", op: ">=", value: 15 }, goto: "trail" }],
    },
    trail: {
      id: "trail",
      text: "There is a trail into the valley, and someone who knows it.",
      choices: [
        {
          id: "trade",
          text: "Pay the guide for everything they know.",
          requires: { kind: "resource", resource: "gold", op: ">=", value: 40 },
          effects: [
            { kind: "resource", resource: "gold", delta: -40 },
            { kind: "resource", resource: "intel", delta: 18 },
          ],
          goto: "quarry",
        },
        {
          id: "hunt",
          text: "Walk it yourselves and take the cost.",
          requires: { kind: "partySize", op: ">=", value: 3 },
          effects: [
            { kind: "resource", resource: "intel", delta: 10 },
            { kind: "damage", amount: 5, target: "party" },
          ],
          goto: "quarry",
        },
      ],
    },
    quarry: {
      id: "quarry",
      text: "The valley is mapped. The barrow at its head is no longer a rumour.",
      onEnter: [
        { kind: "resource", resource: "renown", delta: 8 },
        { kind: "unlockRaid", raid: "ashen-barrow" },
      ],
      terminal: true,
      outcome: "mapped",
    },
  },
};

export const arcs: Record<string, Arc> = {
  [compact.id]: compact,
  [marches.id]: marches,
};
