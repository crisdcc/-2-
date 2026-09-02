import type { LogChannel, LogEntry } from "./types";

/** Collects the chronicle of a run, newest entries appended last. */
export class GameLog {
  private readonly entries: LogEntry[] = [];

  write(day: number, channel: LogChannel, message: string): void {
    this.entries.push({ day, channel, message });
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  /** Entries recorded on a specific day. */
  forDay(day: number): LogEntry[] {
    return this.entries.filter((entry) => entry.day === day);
  }

  since(index: number): LogEntry[] {
    return this.entries.slice(index);
  }

  get length(): number {
    return this.entries.length;
  }
}

export function formatEntry(entry: LogEntry): string {
  const tag = entry.channel.toUpperCase().padEnd(9);
  return `Day ${String(entry.day).padStart(3)} ${tag} ${entry.message}`;
}
