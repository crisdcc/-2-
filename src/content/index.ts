import type { Content } from "../core/types";
import { abilities, resources, reserves, startingParty } from "./abilities";
import { events } from "./events";
import { arcs } from "./arcs";
import { raids } from "./raids";

/** The default scenario shipped with the engine: the Ember Marches campaign. */
export const emberMarches: Content = {
  resources,
  abilities,
  events,
  arcs,
  raids,
  startingParty,
  reserves,
};

export { abilities, resources, reserves, startingParty, events, arcs, raids };
