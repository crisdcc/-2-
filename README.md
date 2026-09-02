# chronicle-engine

A deterministic, data-driven core for a party-based campaign game, built around
three systems that share one world state:

| System | What it does | Lives in |
| --- | --- | --- |
| **Events** | Picks what happens in the world each day — gated, weighted, on cooldowns, or scheduled | `src/events/` |
| **Narratives** | Runs story arcs as state machines with branching, gated player choices | `src/narrative/` |
| **Raids** | Resolves phase-based party encounters with abilities, mechanics and loot | `src/raid/` |

Everything downstream of the seed is reproducible: two runs with the same seed,
content and strategies produce byte-identical chronicles.

## Playing it

Needs [Node.js](https://nodejs.org/) 20 or newer. Works on Windows, macOS and
Linux.

```bash
git clone https://github.com/crisdcc/-2-.git
cd -2-
npm install
npm run play
```

You live one day at a time. Press **Enter** to let a day pass, **r** to march on
a stronghold, and pick narrative choices yourself when an arc branches —
options you cannot afford are shown greyed out, with the requirement spelled
out next to them.

| Key | Does |
| --- | --- |
| `Enter` | live through the next day |
| `r` | march on a stronghold |
| `p` | the company — health, roles, who is laid up |
| `s` | standing, story threads and open ground |
| `j` | the journal so far |
| `<n>` | let *n* days pass at once |
| `q` | give up the campaign |

`npm run play -- --seed bravo` replays an exact world; `--terse` hides the
blow-by-blow of fights. Without a seed, every run is a new one.

## Running it headless

```bash
npm run sim                  # simulate 40 days with no player, print the chronicle
npm test                     # 124 tests
npm run typecheck
npm run check                # typecheck + tests
```

```
npm run sim -- --seed bravo --days 60 --choices random --verbose
```

| Flag | Meaning |
| --- | --- |
| `--seed <string>` | Seed for the run (default `ember`) |
| `--days <n>` | Days to simulate (default 40) |
| `--events <n>` | Events the director places per day (default 1) |
| `--choices first\|random` | How narrative choices get made |
| `--no-raids` | Never send the company out |
| `--verbose` | Include per-action lines in raid logs |
| `--json` | Emit final state and log as JSON |

`sim` is the engine driving itself — useful for balance work and for seeing a
whole campaign at once. `play` is the same engine with you in the chair.

## The day loop

`Game.tick()` advances the world by exactly one day:

```
upkeep → world events → narrative → raid → narrative again → end checks
```

The narrative runs a second time after the raid so a stronghold cleared today
advances its arc today rather than tomorrow. Upkeep eats supplies, rests the
party, and applies a point of morale drift — every morale gain in the content
has to out-pace that, which is what keeps a run from coasting.

Loss conditions live in the engine (nobody standing, or morale at zero).
*Victory is content-driven*: an arc reaches a stage whose effect is
`endRun: victory`. The engine has no idea what winning means.

## How content works

Content is plain data — `Condition` predicates and `Effect` mutations, both
serialisable. The whole schema is in [`src/core/types.ts`](src/core/types.ts),
and `src/content/` holds the shipped campaign, *The Ember Marches*.

**Conditions** are pure and randomness-free, so gating is testable:

```ts
requires: {
  kind: "all",
  of: [
    { kind: "raidCleared", raid: "ashen-barrow" },
    { kind: "partySize", op: ">=", value: 5 },
  ],
}
```

**Effects** are the single mutation path into world state — resources (clamped
to their declared bounds), flags, arc movement, party damage and healing,
recruitment, raid unlocks, scheduled events, and the run's ending.

### Events

The director selects in two stages: the highest *priority tier* with anything
eligible crowds out every lower tier, then one event is drawn by weight within
it. That lets an urgent story beat pre-empt ambient flavour without needing an
absurd weight. Events can also be gated (`requires`), rate-limited
(`cooldownDays`), capped (`maxFires`), or given `weight: 0` so they are
unreachable by rolling and only ever arrive because something scheduled them —
which is how *The Black Sun* summons an envoy three days later.

### Narratives

An arc is a state machine. Stages narrate, `onEnter` effects fire once on entry,
`transitions` advance automatically when the world agrees, and `choices` hand
the decision to a `ChoiceStrategy` (`firstAvailable`, `randomChoice`, or
`scripted({...})` for tests). Options whose `requires` fail are never offered.
Arcs begin on their own when `autoStart` becomes true.

An arc that cannot settle within 32 steps throws rather than hanging, and
transitions pointing at missing stages are reported by name.

### Raids

Round-based and fully deterministic. Party members act by an AI that reacts to
the state of the fight — heal when someone is hurt, area damage when there is a
crowd, otherwise focus the weakest enemy. Enemies pick targets by threat, which
is why vanguards exist. Phases run in sequence against a shared round budget;
running it out is a retreat, not a wipe.

Mechanics are declarative: `enrage`, `aoe`, `shield`, `adds`. Downed members are
carried home at 1 hp and laid up for a couple of days rather than killed, so a
run ends through morale and story rather than one bad fight.

## Determinism

`Rng` is a seeded mulberry32. The important part is `stream(label)`: sub-streams
are derived from the seed *and a label*, not from the parent's position, so
consuming an extra roll in one system can never shift the numbers another system
sees. A raid drawing loot cannot perturb tomorrow's events.

```ts
const rng = new Rng("ember");
rng.stream("day:12").stream("events");     // always the same numbers
```

## Content validation

`validateContent` walks a bundle before a run starts and reports every broken
reference at once — unknown resources, arcs, raids, abilities and recruits;
stages that are dead ends; ids that disagree with their key; transitions and
choices pointing at stages that do not exist. `Game` runs it on construction, so
a typo in content is one clear report instead of an exception 30 days into a
simulation.

## Layout

```
src/
  core/       types, seeded rng, world state, conditions, effects, log
  events/     the event director
  narrative/  arcs, stages, choice strategies
  raid/       combat resolution, planners, applying results
  sim/        the day loop and content validation
  content/    The Ember Marches — abilities, events, arcs, raids
  play.ts     interactive terminal game
  cli.ts      chronicle renderer for headless runs
tests/        124 tests across all of the above
```

## Using it as a library

```ts
import { Game, scripted } from "./src";

const game = new Game({
  seed: "ember",
  chooser: scripted({ compact: "pledge" }),
});

for (const report of game.run(60)) {
  for (const entry of report.entries) console.log(entry.message);
}
console.log(game.state.status, game.state.statusReason);
```

Swap `content` for your own bundle and none of the engine changes.
