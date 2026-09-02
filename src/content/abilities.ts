import type { Ability, PartyMember, ResourceDef } from "../core/types";

export const resources: ResourceDef[] = [
  { id: "gold", name: "Gold", min: 0, max: 9999, initial: 120 },
  { id: "supplies", name: "Supplies", min: 0, max: 400, initial: 40 },
  { id: "renown", name: "Renown", min: 0, max: 100, initial: 0 },
  { id: "intel", name: "Intelligence", min: 0, max: 100, initial: 0 },
  { id: "morale", name: "Morale", min: 0, max: 100, initial: 60 },
];

function ability(a: Ability): [string, Ability] {
  return [a.id, a];
}

export const abilities: Record<string, Ability> = Object.fromEntries([
  ability({ id: "shield-wall", name: "Shield Wall", kind: "guard", power: 8, cooldown: 3, priority: 5 }),
  ability({ id: "cleave", name: "Cleave", kind: "strike", power: 1.25, cooldown: 2, priority: 3 }),
  ability({ id: "aimed-shot", name: "Aimed Shot", kind: "strike", power: 1.6, cooldown: 3, priority: 4 }),
  ability({ id: "quick-shot", name: "Quick Shot", kind: "strike", power: 0.9, cooldown: 0, priority: 1 }),
  ability({ id: "mend", name: "Mend", kind: "mend", power: 14, cooldown: 2, priority: 6 }),
  ability({ id: "ward", name: "Ward", kind: "guard", power: 6, cooldown: 4, priority: 4 }),
  ability({ id: "firebolt", name: "Firebolt", kind: "strike", power: 1.4, cooldown: 2, priority: 3 }),
  ability({ id: "flame-arc", name: "Flame Arc", kind: "volley", power: 0.8, cooldown: 3, priority: 5 }),
]);

function member(m: Omit<PartyMember, "hp" | "injuredUntil"> & { hp?: number }): PartyMember {
  return { ...m, hp: m.hp ?? m.maxHp, injuredUntil: -1 };
}

export const startingParty: PartyMember[] = [
  member({
    id: "bram", name: "Bram Holt", role: "vanguard", level: 2,
    maxHp: 60, attack: 9, defense: 8, speed: 5,
    abilities: ["shield-wall", "cleave"],
  }),
  member({
    id: "sela", name: "Sela Vance", role: "ranger", level: 2,
    maxHp: 42, attack: 12, defense: 4, speed: 9,
    abilities: ["aimed-shot", "quick-shot"],
  }),
  member({
    id: "orin", name: "Orin Kesh", role: "warden", level: 2,
    maxHp: 48, attack: 8, defense: 6, speed: 6,
    abilities: ["mend", "ward"],
  }),
  member({
    id: "nyra", name: "Nyra Dell", role: "arcanist", level: 2,
    maxHp: 38, attack: 13, defense: 3, speed: 7,
    abilities: ["flame-arc", "firebolt"],
  }),
];

export const reserves: PartyMember[] = [
  member({
    id: "toma", name: "Toma Reed", role: "vanguard", level: 1,
    maxHp: 55, attack: 8, defense: 7, speed: 5, abilities: ["shield-wall"],
  }),
  member({
    id: "jessa", name: "Jessa Kor", role: "ranger", level: 1,
    maxHp: 40, attack: 11, defense: 4, speed: 9, abilities: ["quick-shot"],
  }),
  member({
    id: "ferrin", name: "Ferrin Ash", role: "warden", level: 1,
    maxHp: 46, attack: 7, defense: 6, speed: 6, abilities: ["mend"],
  }),
];
