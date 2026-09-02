import { describe, expect, it } from "vitest";
import { EventDirector } from "../src/events/director";
import { Rng } from "../src/core/rng";
import { GameLog } from "../src/core/log";
import type { GameEvent } from "../src/core/types";
import { harness, messages } from "./fixtures";

function event(over: Partial<GameEvent> & { id: string }): GameEvent {
  return {
    title: over.id,
    category: "world",
    weight: 1,
    narration: `${over.id} happens`,
    ...over,
  };
}

describe("EventDirector", () => {
  it("refuses content with duplicate event ids", () => {
    const h = harness({ events: [event({ id: "a" }), event({ id: "a" })] });
    expect(() => new EventDirector(h.content)).toThrow(/duplicate event ids/);
  });

  it("only offers events whose requirements pass", () => {
    const h = harness({
      events: [
        event({ id: "open" }),
        event({ id: "rich", requires: { kind: "resource", resource: "gold", op: ">=", value: 400 } }),
      ],
    });
    const director = new EventDirector(h.content);
    expect(director.eligible(h.state).map((e) => e.id)).toEqual(["open"]);

    h.state.resources["gold"] = 400;
    expect(director.eligible(h.state).map((e) => e.id)).toEqual(["open", "rich"]);
  });

  it("never offers a zero-weight event to the roll", () => {
    const h = harness({ events: [event({ id: "scheduled-only", weight: 0 })] });
    const director = new EventDirector(h.content);
    expect(director.eligible(h.state)).toEqual([]);
    expect(director.tick(h.state, new Rng("x"), h.log)).toEqual([]);
  });

  it("holds an event back until its cooldown elapses", () => {
    const h = harness({ events: [event({ id: "a", cooldownDays: 3 })] });
    const director = new EventDirector(h.content);
    h.state.day = 10;
    director.fire(h.content.events[0]!, h.state, new Rng("x"), h.log);

    for (const [day, expected] of [[11, false], [12, false], [13, true]] as const) {
      h.state.day = day;
      expect(director.eligible(h.state).length > 0).toBe(expected);
    }
  });

  it("retires an event once it hits its firing cap", () => {
    const h = harness({ events: [event({ id: "once", maxFires: 2 })] });
    const director = new EventDirector(h.content);
    const rng = new Rng("x");

    director.tick(h.state, rng, h.log);
    director.tick(h.state, rng, h.log);
    expect(h.state.events["once"]!.count).toBe(2);
    expect(director.eligible(h.state)).toEqual([]);
    expect(director.tick(h.state, rng, h.log)).toEqual([]);
  });

  it("lets the highest priority tier crowd out everything below it", () => {
    const h = harness({
      events: [
        event({ id: "ambient", weight: 1000 }),
        event({ id: "urgent", weight: 1, priority: 1 }),
      ],
    });
    const director = new EventDirector(h.content, { eventsPerDay: 1 });
    for (let day = 1; day <= 20; day++) {
      h.state.day = day;
      const [fired] = director.tick(h.state, new Rng(`d${day}`), h.log);
      expect(fired!.event.id).toBe("urgent");
    }
  });

  it("does not fire the same event twice in one day", () => {
    const h = harness({ events: [event({ id: "a" }), event({ id: "b" })] });
    const director = new EventDirector(h.content, { eventsPerDay: 3 });
    const fired = director.tick(h.state, new Rng("x"), h.log);
    expect(fired.map((f) => f.event.id).sort()).toEqual(["a", "b"]);
  });

  it("respects weights when drawing within a tier", () => {
    const h = harness({
      events: [event({ id: "common", weight: 9 }), event({ id: "rare", weight: 1 })],
    });
    const director = new EventDirector(h.content);
    const tally: Record<string, number> = { common: 0, rare: 0 };
    for (let day = 1; day <= 4000; day++) {
      const state = harness({ events: h.content.events }).state;
      state.day = day;
      const [fired] = director.tick(state, new Rng(`seed-${day}`), new GameLog());
      tally[fired!.event.id] = (tally[fired!.event.id] ?? 0) + 1;
    }
    expect(tally["common"]! / tally["rare"]!).toBeGreaterThan(6);
    expect(tally["common"]! / tally["rare"]!).toBeLessThan(14);
  });

  it("delivers scheduled events even when their requirements fail", () => {
    const h = harness({ events: [event({ id: "envoy", weight: 0, requires: { kind: "never" } })] });
    const director = new EventDirector(h.content);
    h.state.day = 4;
    h.state.scheduled.push({ eventId: "envoy", day: 4 });

    const fired = director.tick(h.state, new Rng("x"), h.log);
    expect(fired).toEqual([{ event: h.content.events[0], source: "scheduled" }]);
    expect(h.state.scheduled).toEqual([]);
  });

  it("leaves a scheduled event alone until its day arrives", () => {
    const h = harness({ events: [event({ id: "envoy", weight: 0 })] });
    const director = new EventDirector(h.content);
    h.state.day = 2;
    h.state.scheduled.push({ eventId: "envoy", day: 5 });
    expect(director.tick(h.state, new Rng("x"), h.log)).toEqual([]);
    expect(h.state.scheduled).toHaveLength(1);
  });

  it("drops scheduled entries that point at unknown events", () => {
    const h = harness({ events: [event({ id: "a" })] });
    const director = new EventDirector(h.content);
    h.state.day = 1;
    h.state.scheduled.push({ eventId: "ghost", day: 1 });
    director.tick(h.state, new Rng("x"), h.log);
    expect(h.state.scheduled).toEqual([]);
    expect(h.state.events["ghost"]).toBeUndefined();
  });

  it("records the firing and applies the event's effects", () => {
    const h = harness({
      events: [event({ id: "boon", effects: [{ kind: "resource", resource: "gold", delta: 25 }] })],
    });
    const director = new EventDirector(h.content);
    h.state.day = 6;
    director.tick(h.state, new Rng("x"), h.log);

    expect(h.state.events["boon"]).toEqual({ count: 1, lastDay: 6 });
    expect(h.state.resources["gold"]).toBe(125);
    expect(messages(h.log)[0]).toBe("boon — boon happens");
    expect(h.log.all()[0]!.channel).toBe("event");
  });

  it("is deterministic for a given seed", () => {
    const events = [
      event({ id: "a", weight: 3 }),
      event({ id: "b", weight: 2 }),
      event({ id: "c", weight: 1 }),
    ];
    const runOnce = (): string[] => {
      const h = harness({ events });
      const director = new EventDirector(h.content, { eventsPerDay: 2 });
      const out: string[] = [];
      for (let day = 1; day <= 25; day++) {
        h.state.day = day;
        for (const fired of director.tick(h.state, new Rng(`day:${day}`), h.log)) {
          out.push(fired.event.id);
        }
      }
      return out;
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it("stops placing events once the run has ended", () => {
    const h = harness({
      events: [event({ id: "end", effects: [{ kind: "endRun", status: "defeat", reason: "over" }] })],
    });
    const director = new EventDirector(h.content, { eventsPerDay: 5 });
    const fired = director.tick(h.state, new Rng("x"), h.log);
    expect(fired).toHaveLength(1);
  });
});
