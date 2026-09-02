import type { GameEvent } from "../core/types";

/**
 * The ambient world. Weights are relative within a priority tier; `weight: 0`
 * marks an event that can only ever arrive because something scheduled it.
 */
export const events: GameEvent[] = [
  {
    id: "quiet-roads",
    title: "Quiet Roads",
    category: "world",
    weight: 10,
    cooldownDays: 2,
    narration: "The marches are still. The company makes good ground.",
    effects: [{ kind: "resource", resource: "morale", delta: 2 }],
  },
  {
    id: "merchant-caravan",
    title: "Merchant Caravan",
    category: "world",
    weight: 6,
    cooldownDays: 4,
    requires: { kind: "day", op: ">=", value: 2 },
    narration: "A caravan pays well for an escort through the pass.",
    effects: [
      { kind: "resource", resource: "gold", delta: 25 },
      { kind: "resource", resource: "supplies", delta: 4 },
    ],
  },
  {
    id: "supply-cache",
    title: "Forgotten Cache",
    category: "world",
    weight: 5,
    cooldownDays: 3,
    narration: "Sela turns up a cache under a cairn stone.",
    effects: [{ kind: "resource", resource: "supplies", delta: 9 }],
  },
  {
    id: "scout-report",
    title: "Scout's Report",
    category: "world",
    weight: 7,
    cooldownDays: 3,
    narration: "Riders come back with the shape of the country ahead.",
    effects: [{ kind: "resource", resource: "intel", delta: 8 }],
  },
  {
    id: "tithe-collector",
    title: "The Tithe Collector",
    category: "world",
    weight: 4,
    cooldownDays: 8,
    requires: { kind: "resource", resource: "gold", op: ">=", value: 60 },
    narration: "A crown officer takes his cut, and remembers who paid.",
    effects: [
      { kind: "resource", resource: "gold", delta: -40 },
      { kind: "resource", resource: "renown", delta: 5 },
    ],
  },
  {
    id: "restless-night",
    title: "Restless Night",
    category: "company",
    weight: 6,
    cooldownDays: 2,
    narration: "Nobody sleeps well, but the wounds close a little.",
    effects: [
      { kind: "heal", amount: 5, target: "party" },
      { kind: "resource", resource: "morale", delta: -2 },
    ],
  },
  {
    id: "fever-camp",
    title: "Fever in Camp",
    category: "company",
    weight: 5,
    cooldownDays: 6,
    requires: { kind: "day", op: ">=", value: 4 },
    narration: "Something in the water goes through the tents.",
    effects: [
      { kind: "damage", amount: 6, target: "party" },
      { kind: "resource", resource: "morale", delta: -3 },
    ],
  },
  {
    id: "desertion",
    title: "Empty Bedroll",
    category: "company",
    weight: 8,
    cooldownDays: 4,
    requires: {
      kind: "all",
      of: [
        { kind: "resource", resource: "morale", op: "<", value: 30 },
        { kind: "partySize", op: ">", value: 3 },
      ],
    },
    narration: "Someone's kit is gone before dawn. No one says the name aloud.",
    effects: [
      { kind: "resource", resource: "morale", delta: -4 },
      { kind: "injure", days: 1, target: "random" },
    ],
  },
  {
    id: "veteran-at-the-gate",
    title: "Veteran at the Gate",
    category: "company",
    weight: 5,
    cooldownDays: 6,
    maxFires: 3,
    requires: { kind: "resource", resource: "renown", op: ">=", value: 10 },
    narration: "Word of the company travels. Someone comes looking for work.",
    effects: [{ kind: "recruit" }],
  },
  {
    id: "omen-black-sun",
    title: "The Black Sun",
    category: "omen",
    weight: 3,
    cooldownDays: 10,
    requires: { kind: "day", op: ">=", value: 5 },
    narration: "The light goes wrong at noon, and the horses will not move.",
    effects: [
      { kind: "setFlag", flag: "omen-seen" },
      { kind: "resource", resource: "morale", delta: -4 },
      { kind: "resource", resource: "intel", delta: 5 },
      { kind: "scheduleEvent", event: "envoy-arrives", inDays: 3 },
    ],
  },
  {
    id: "envoy-arrives",
    title: "An Envoy Arrives",
    category: "omen",
    // Weight 0: unreachable by rolling, only ever delivered by the schedule
    // that "The Black Sun" sets three days earlier.
    weight: 0,
    narration: "A rider in warden's grey has been waiting at the crossroads.",
    effects: [
      { kind: "resource", resource: "intel", delta: 10 },
      { kind: "setFlag", flag: "envoy-met" },
    ],
  },
  {
    id: "triumph-toasted",
    title: "A Victory Toasted",
    category: "company",
    weight: 9,
    priority: 1,
    cooldownDays: 5,
    requires: {
      kind: "all",
      of: [
        { kind: "raidCleared", raid: "ashen-barrow" },
        { kind: "resource", resource: "morale", op: "<", value: 80 },
      ],
    },
    narration: "The barrow's fall is worth a night's drinking.",
    effects: [
      { kind: "resource", resource: "morale", delta: 7 },
      { kind: "resource", resource: "gold", delta: -10 },
    ],
  },
];
