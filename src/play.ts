#!/usr/bin/env node
/**
 * Interactive terminal front-end: you live one day at a time, make the
 * narrative choices yourself and decide when the company marches.
 *
 * The engine's strategy hooks are synchronous, so input is read with a
 * blocking read on fd 0 rather than `readline`. That keeps the whole
 * interactive layer inside this one file - the engine stays untouched.
 */
import fs from "node:fs";
import { Game } from "./sim/game";
import { availableRaids } from "./raid/expedition";
import { partyPower, readyParty } from "./core/state";
import type {
  Content,
  LogChannel,
  LogEntry,
  PendingChoice,
  RaidDefinition,
  WorldState,
} from "./core/types";

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const ESC = String.fromCharCode(27);
const COLOR = process.stdout.isTTY === true && !process.env["NO_COLOR"];
const paint =
  (code: string) =>
  (text: string): string =>
    COLOR ? `${ESC}[${code}m${text}${ESC}[0m` : text;

const bold = paint("1");
const dim = paint("2");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const blue = paint("34");
const magenta = paint("35");
const cyan = paint("36");

const CHANNEL_STYLE: Record<LogChannel, { glyph: string; color: (s: string) => string }> = {
  event: { glyph: "*", color: cyan },
  narrative: { glyph: "#", color: magenta },
  choice: { glyph: ">", color: yellow },
  raid: { glyph: "x", color: red },
  loot: { glyph: "+", color: green },
  system: { glyph: "!", color: blue },
};

const RULE = "-".repeat(68);

function say(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function renderEntry(entry: LogEntry): string {
  const style = CHANNEL_STYLE[entry.channel];
  // Effect lines ("gold +25") read as consequences of the line above them.
  const detail = /^[a-z]+ [+-]\d+$/.test(entry.message);
  const body = detail ? dim(entry.message) : entry.message;
  return `  ${style.color(style.glyph)} ${body}`;
}

function statusBar(state: WorldState): string {
  const ready = readyParty(state).length;
  const alive = state.party.filter((m) => m.hp > 0).length;
  const resources = Object.entries(state.resources)
    .map(([id, value]) => `${dim(id)} ${value}`)
    .join("  ");
  return `${bold(`Day ${state.day}`)}  ${dim("|")}  ${ready}/${alive} fit  ${dim("|")}  ${resources}`;
}

// ---------------------------------------------------------------------------
// Blocking line input
// ---------------------------------------------------------------------------

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const pending: string[] = [];
let tail = "";
let atEof = false;

/** Reads one chunk from stdin, waiting rather than spinning on EAGAIN. */
function readChunk(): string | null {
  const buffer = Buffer.alloc(4096);
  for (;;) {
    try {
      const bytes = fs.readSync(0, buffer, 0, buffer.length, null);
      return bytes === 0 ? null : buffer.toString("utf8", 0, bytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN") {
        Atomics.wait(sleeper, 0, 0, 20);
        continue;
      }
      // EOF on some platforms surfaces as an error rather than a zero read.
      if (code === "EOF" || code === "ENXIO" || code === "EBADF") return null;
      throw error;
    }
  }
}

/** One line of input, or `null` once stdin is exhausted. */
function readLine(): string | null {
  while (pending.length === 0) {
    if (atEof) {
      if (tail.length === 0) return null;
      const rest = tail;
      tail = "";
      return rest.trim();
    }
    const chunk = readChunk();
    if (chunk === null) {
      atEof = true;
      continue;
    }
    tail += chunk;
    let index: number;
    while ((index = tail.indexOf("\n")) >= 0) {
      pending.push(tail.slice(0, index).replace(/\r$/, ""));
      tail = tail.slice(index + 1);
    }
  }
  return pending.shift()!.trim();
}

function ask(question: string): string | null {
  process.stdout.write(question);
  const answer = readLine();
  if (answer === null) say();
  return answer;
}

// ---------------------------------------------------------------------------
// Interactive strategies
// ---------------------------------------------------------------------------

/** Set once stdin runs out, so the outer loop can stop cleanly. */
let inputExhausted = false;

function chooseInteractively(prompt: PendingChoice): string {
  const openOptions = prompt.options.filter((option) => option.available);

  say();
  say(`  ${magenta("#")} ${bold(prompt.prompt)}`);
  prompt.options.forEach((option, index) => {
    if (option.available) {
      say(`      ${yellow(`${index + 1})`)} ${option.text}`);
    } else {
      const why = option.requirement ? ` ${dim(`- needs ${option.requirement}`)}` : "";
      say(`      ${dim(`${index + 1}) ${option.text}`)}${why}`);
    }
  });

  for (;;) {
    const answer = ask(`  ${bold(">")} `);
    if (answer === null) {
      inputExhausted = true;
      return openOptions[0]!.id;
    }
    const index = Number(answer) - 1;
    const picked = prompt.options[index];
    if (picked && picked.available) return picked.id;
    say(dim(`      Pick one of the open options: 1-${prompt.options.length}.`));
  }
}

/** The raid the player committed to this turn, consumed by the planner. */
let plannedRaid: string | null = null;

function planRaid(_state: WorldState, candidates: RaidDefinition[]): string | null {
  const wanted = plannedRaid;
  plannedRaid = null;
  if (!wanted) return null;
  if (!candidates.some((raid) => raid.id === wanted)) {
    say(dim("  The way is no longer open today."));
    return null;
  }
  return wanted;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function showParty(state: WorldState): void {
  say();
  say(bold("  The company"));
  for (const member of state.party) {
    const condition =
      member.hp <= 0
        ? red("fallen")
        : member.injuredUntil >= state.day
          ? yellow("injured")
          : green("fit");
    const bar = `${member.hp}/${member.maxHp}`;
    say(`    ${member.name.padEnd(13)} ${dim(member.role.padEnd(9))} ${bar.padEnd(8)} ${condition}`);
  }
  say(`    ${dim(`party power ${partyPower(state)}`)}`);
  say();
}

function showStatus(state: WorldState, content: Content): void {
  say();
  say(bold("  Standing"));
  for (const def of content.resources) {
    say(`    ${def.name.padEnd(14)} ${state.resources[def.id] ?? 0}`);
  }

  const arcs = Object.values(state.arcs);
  if (arcs.length > 0) {
    say();
    say(bold("  Threads"));
    for (const arc of arcs) {
      const title = content.arcs[arc.arcId]?.title ?? arc.arcId;
      const where = arc.completed
        ? green(`ended - ${arc.outcome ?? "done"}`)
        : dim(`at "${arc.stage}"`);
      say(`    ${title.padEnd(28)} ${where}`);
    }
  }

  const open = availableRaids(state, content);
  if (open.length > 0) {
    say();
    say(bold("  Open ground"));
    for (const raid of open) {
      const cleared = state.clearedRaids.includes(raid.id) ? green(" (cleared)") : "";
      say(`    ${raid.name.padEnd(28)} ${dim(`tier ${raid.tier}`)}${cleared}`);
    }
  }
  say();
}

function showJournal(entries: LogEntry[], count: number): void {
  say();
  say(bold(`  Journal - last ${Math.min(count, entries.length)} entries`));
  for (const entry of entries.slice(-count)) {
    say(`  ${dim(`d${String(entry.day).padStart(3)}`)}${renderEntry(entry)}`);
  }
  say();
}

function showHelp(): void {
  say();
  say(bold("  Commands"));
  say(`    ${yellow("Enter")}   live through the next day`);
  say(`    ${yellow("r")}       march on a stronghold`);
  say(`    ${yellow("p")}       the company`);
  say(`    ${yellow("s")}       standing, threads and open ground`);
  say(`    ${yellow("j")}       the journal so far`);
  say(`    ${yellow("<n>")}     let <n> days pass`);
  say(`    ${yellow("q")}       give up the campaign`);
  say();
}

/** Offers the open strongholds and records the player's pick for this tick. */
function chooseRaid(state: WorldState, content: Content): boolean {
  const open = availableRaids(state, content);
  if (open.length === 0) {
    say(dim("  Nowhere to march on yet."));
    return false;
  }

  const fit = readyParty(state);
  const hp = fit.reduce((sum, m) => sum + m.hp, 0);
  const max = fit.reduce((sum, m) => sum + m.maxHp, 0);
  const health = max === 0 ? 0 : Math.round((hp / max) * 100);

  say();
  say(`  ${bold("Where to?")} ${dim(`${fit.length} fit, ${health}% health`)}`);
  open.forEach((raid, index) => {
    const cleared = state.clearedRaids.includes(raid.id) ? green(" cleared") : "";
    say(`      ${yellow(`${index + 1})`)} ${raid.name} ${dim(`tier ${raid.tier}`)}${cleared}`);
  });
  say(`      ${yellow("0)")} ${dim("stay in camp")}`);

  for (;;) {
    const answer = ask(`  ${bold(">")} `);
    if (answer === null) {
      inputExhausted = true;
      return false;
    }
    if (answer === "" || answer === "0") return false;
    const raid = open[Number(answer) - 1];
    if (raid) {
      plannedRaid = raid.id;
      return true;
    }
    say(dim(`      Pick 1-${open.length}, or 0 to stay.`));
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function playDay(game: Game): void {
  const report = game.tick();
  say();
  say(dim(RULE));
  say(` ${statusBar(game.state)}`);
  say(dim(RULE));
  if (report.entries.length === 0) {
    say(dim("  Nothing worth writing down."));
  }
  for (const entry of report.entries) say(renderEntry(entry));
}

function ending(game: Game): void {
  const { state } = game;
  say();
  say(dim(RULE));
  const headline =
    state.status === "victory"
      ? green(bold("VICTORY"))
      : state.status === "defeat"
        ? red(bold("DEFEAT"))
        : yellow(bold("UNRESOLVED"));
  say(` ${headline}${state.statusReason ? ` - ${state.statusReason}` : ""}`);
  say(dim(RULE));
  say(
    `  ${state.day} days | ${state.raids.length} raids | cleared [${
      state.clearedRaids.join(", ") || "none"
    }]`,
  );
  showParty(state);
}

function main(argv: string[]): number {
  let seed = `run-${Date.now()}`;
  let terse = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--seed") {
      const next = argv[++i];
      if (next === undefined) {
        process.stderr.write("Missing value for --seed\n");
        return 2;
      }
      seed = next;
    } else if (arg === "--terse") {
      terse = true;
    } else if (arg === "--help" || arg === "-h") {
      say("Usage: npm run play -- [--seed <string>] [--terse]");
      return 0;
    } else {
      process.stderr.write(`Unknown argument "${arg}"\n`);
      return 2;
    }
  }

  const game = new Game({
    seed,
    chooser: chooseInteractively,
    raidPlanner: planRaid,
    verboseRaids: !terse,
  });

  say();
  say(bold("  THE EMBER MARCHES"));
  say(dim(`  seed "${seed}" - press Enter to live a day, h for commands`));
  showParty(game.state);

  while (!game.finished && !inputExhausted) {
    const open = availableRaids(game.state, game.content).length;
    const raidHint = open > 0 ? `  ${yellow("[r]")} raid (${open})` : "";
    const answer = ask(
      `\n${dim("[Enter] day")}${raidHint}  ${dim(
        "[p]arty [s]tatus [j]ournal [h]elp [q]uit",
      )}\n${bold(">")} `,
    );

    if (answer === null) break;
    const command = answer.toLowerCase();

    if (command === "q") {
      say(dim("  The company stands down."));
      break;
    }
    if (command === "h") {
      showHelp();
      continue;
    }
    if (command === "p") {
      showParty(game.state);
      continue;
    }
    if (command === "s") {
      showStatus(game.state, game.content);
      continue;
    }
    if (command === "j") {
      showJournal([...game.log.all()], 25);
      continue;
    }
    if (command === "r") {
      if (!chooseRaid(game.state, game.content)) continue;
      playDay(game);
      continue;
    }
    if (/^\d+$/.test(command)) {
      const days = Math.min(Number(command), 365);
      for (let i = 0; i < days && !game.finished && !inputExhausted; i++) playDay(game);
      continue;
    }
    if (command === "") {
      playDay(game);
      continue;
    }
    say(dim("  Unknown command - press h for the list."));
  }

  ending(game);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
