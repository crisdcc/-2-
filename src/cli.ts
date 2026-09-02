#!/usr/bin/env node
import { Game } from "./sim/game";
import { formatEntry } from "./core/log";
import { firstAvailable, randomChoice, type ChoiceStrategy } from "./narrative/engine";
import { cautiousPlanner, neverRaid } from "./raid/expedition";
import { partyPower } from "./core/state";

interface CliOptions {
  seed: string;
  days: number;
  eventsPerDay: number;
  chooser: ChoiceStrategy;
  chooserName: string;
  raids: boolean;
  verbose: boolean;
  json: boolean;
}

const USAGE = `chronicle-engine — simulate a run of the Ember Marches

Usage: npm run sim -- [options]

Options:
  --seed <string>      Seed for the run (default: "ember")
  --days <n>           Days to simulate (default: 40)
  --events <n>         Events the director places per day (default: 1)
  --choices <mode>     Narrative choice strategy: first | random (default: first)
  --no-raids           Never send the company on a raid
  --verbose            Include per-action lines in raid logs
  --json               Emit the final state as JSON instead of a chronicle
  --help               Show this message
`;

function parseArgs(argv: string[]): CliOptions | null {
  const options: CliOptions = {
    seed: "ember",
    days: 40,
    eventsPerDay: 1,
    chooser: firstAvailable,
    chooserName: "first",
    raids: true,
    verbose: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    const number = (): number => {
      const raw = value();
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) throw new Error(`${arg} expects a number, got "${raw}"`);
      return parsed;
    };

    switch (arg) {
      case "--help":
      case "-h":
        return null;
      case "--seed":
        options.seed = value();
        break;
      case "--days":
        options.days = Math.max(1, Math.floor(number()));
        break;
      case "--events":
        options.eventsPerDay = Math.max(0, Math.floor(number()));
        break;
      case "--choices": {
        const mode = value();
        if (mode === "first") options.chooser = firstAvailable;
        else if (mode === "random") options.chooser = randomChoice;
        else throw new Error(`Unknown choice strategy "${mode}" (expected first or random)`);
        options.chooserName = mode;
        break;
      }
      case "--no-raids":
        options.raids = false;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument "${arg}"`);
    }
  }
  return options;
}

function main(argv: string[]): number {
  let options: CliOptions | null;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (!options) {
    process.stdout.write(USAGE);
    return 0;
  }

  const game = new Game({
    seed: options.seed,
    eventsPerDay: options.eventsPerDay,
    chooser: options.chooser,
    raidPlanner: options.raids ? cautiousPlanner() : neverRaid,
    verboseRaids: options.verbose,
  });

  const reports = game.run(options.days);
  const state = game.state;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ state, log: game.log.all() }, null, 2)}\n`,
    );
    return 0;
  }

  const out: string[] = [];
  out.push(`Seed "${options.seed}" · ${options.days} days · choices=${options.chooserName}`);
  out.push("=".repeat(72));

  for (const report of reports) {
    if (report.entries.length === 0) continue;
    for (const entry of report.entries) out.push(formatEntry(entry));
    out.push("");
  }

  out.push("=".repeat(72));
  out.push(`Outcome: ${state.status.toUpperCase()}${state.statusReason ? ` — ${state.statusReason}` : ""}`);
  out.push(`Days elapsed: ${state.day}`);
  out.push(
    `Resources: ${Object.entries(state.resources)
      .map(([id, value]) => `${id} ${value}`)
      .join(" · ")}`,
  );
  out.push(`Party power: ${partyPower(state)}`);
  for (const member of state.party) {
    const status = member.hp <= 0 ? "fallen" : member.injuredUntil >= state.day ? "injured" : "fit";
    out.push(`  ${member.name.padEnd(12)} ${member.role.padEnd(9)} ${member.hp}/${member.maxHp} hp  ${status}`);
  }
  out.push(
    `Raids: ${state.raids.length} attempted, cleared [${state.clearedRaids.join(", ") || "none"}]`,
  );
  for (const arc of Object.values(state.arcs)) {
    const where = arc.completed ? `completed as "${arc.outcome ?? "—"}"` : `at "${arc.stage}"`;
    out.push(`  arc ${arc.arcId}: ${where}`);
  }

  process.stdout.write(`${out.join("\n")}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
