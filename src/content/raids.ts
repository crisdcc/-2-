import type { LootEntry, RaidDefinition } from "../core/types";

const commonLoot: LootEntry[] = [
  { id: "coin", name: "Grave coin", weight: 10, resource: "gold", amount: [30, 60] },
  { id: "rations", name: "Sealed stores", weight: 8, resource: "supplies", amount: [8, 14] },
  { id: "ledger", name: "Warden's ledger", weight: 6, resource: "intel", amount: [5, 10] },
  { id: "relic", name: "Barrow relic", weight: 4, resource: "renown", amount: [3, 6] },
];

export const ashenBarrow: RaidDefinition = {
  id: "ashen-barrow",
  name: "The Ashen Barrow",
  tier: 1,
  maxRounds: 18,
  lootRolls: 2,
  loot: commonLoot,
  phases: [
    {
      id: "barrow-mouth",
      name: "The Barrow Mouth",
      enemies: [
        { id: "hound", name: "Barrow hound", hp: 26, attack: 7, defense: 2, speed: 8, count: 3 },
      ],
    },
    {
      id: "the-cairn",
      name: "The Cairn",
      enemies: [{ id: "wight", name: "Cairn wight", hp: 110, attack: 12, defense: 5, speed: 5 }],
      mechanics: [{ kind: "aoe", everyRounds: 4, damage: 7, name: "Grave-chill" }],
    },
  ],
  onVictory: [
    { kind: "resource", resource: "morale", delta: 6 },
    { kind: "log", message: "The cairn stone is broken and the road beyond it is open." },
  ],
  onDefeat: [{ kind: "resource", resource: "morale", delta: -8 }],
};

export const emberHold: RaidDefinition = {
  id: "ember-hold",
  name: "The Ember Hold",
  tier: 2,
  maxRounds: 26,
  lootRolls: 3,
  // Needs both the barrow cleared and a company large enough to hold the yard,
  // which means recruiting — the raid gate reaches back into the event system.
  requires: {
    kind: "all",
    of: [
      { kind: "raidCleared", raid: "ashen-barrow" },
      { kind: "partySize", op: ">=", value: 5 },
    ],
  },
  loot: [
    ...commonLoot,
    { id: "hoard", name: "Forge hoard", weight: 6, resource: "gold", amount: [80, 140] },
    { id: "codex", name: "Sealing codex", weight: 7, resource: "intel", amount: [12, 20] },
  ],
  phases: [
    {
      id: "outer-yard",
      name: "The Outer Yard",
      enemies: [
        { id: "thrall", name: "Ember thrall", hp: 32, attack: 9, defense: 3, speed: 7, count: 5 },
      ],
      mechanics: [
        {
          kind: "adds",
          everyRounds: 4,
          name: "Cinders gutter into shape",
          template: { id: "wisp", name: "Cinder wisp", hp: 18, attack: 6, defense: 1, speed: 9 },
        },
      ],
    },
    {
      id: "the-forge",
      name: "The Forge",
      enemies: [{ id: "tyrant", name: "Forge tyrant", hp: 190, attack: 16, defense: 8, speed: 6 }],
      mechanics: [
        { kind: "shield", everyRounds: 3, amount: 14, name: "Slag plating" },
        { kind: "enrage", afterRound: 9, attackBonus: 2 },
      ],
    },
  ],
  onVictory: [
    { kind: "resource", resource: "renown", delta: 15 },
    { kind: "resource", resource: "morale", delta: 8 },
  ],
  onDefeat: [
    { kind: "resource", resource: "morale", delta: -12 },
    { kind: "resource", resource: "supplies", delta: -10 },
  ],
};

export const raids: Record<string, RaidDefinition> = {
  [ashenBarrow.id]: ashenBarrow,
  [emberHold.id]: emberHold,
};
