import { describe, expect, it } from "vitest";
import { NarrativeEngine, firstAvailable, randomChoice, scripted } from "../src/narrative/engine";
import { Rng } from "../src/core/rng";
import type { Arc } from "../src/core/types";
import { harness, messages } from "./fixtures";

const linear: Arc = {
  id: "linear",
  title: "Linear",
  summary: "",
  start: "a",
  autoStart: { kind: "day", op: ">=", value: 2 },
  stages: {
    a: {
      id: "a",
      text: "stage a",
      onEnter: [{ kind: "resource", resource: "gold", delta: 10 }],
      transitions: [{ requires: { kind: "flag", flag: "go" }, goto: "b" }],
    },
    b: { id: "b", text: "stage b", terminal: true, outcome: "finished" },
  },
};

const branching: Arc = {
  id: "branch",
  title: "Branch",
  summary: "",
  start: "fork",
  stages: {
    fork: {
      id: "fork",
      text: "which way?",
      choices: [
        {
          id: "rich",
          text: "pay",
          requires: { kind: "resource", resource: "gold", op: ">=", value: 200 },
          effects: [{ kind: "setFlag", flag: "paid" }],
          goto: "paid",
        },
        { id: "cheap", text: "walk", effects: [{ kind: "setFlag", flag: "walked" }], goto: "walked" },
      ],
    },
    paid: { id: "paid", text: "paid path", terminal: true, outcome: "paid" },
    walked: { id: "walked", text: "walked path", terminal: true, outcome: "walked" },
  },
};

function run(arcs: Record<string, Arc>, over = {}, seed = "n") {
  const h = harness({ arcs, ...over }, seed);
  const engine = new NarrativeEngine(h.content);
  return { h, engine };
}

describe("NarrativeEngine", () => {
  it("starts an arc only once its autoStart condition holds", () => {
    const { h, engine } = run({ linear });
    h.state.day = 1;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["linear"]).toBeUndefined();

    h.state.day = 2;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["linear"]).toMatchObject({ stage: "a", startedDay: 2 });
  });

  it("runs a stage's onEnter effects exactly once", () => {
    const { h, engine } = run({ linear });
    h.state.day = 2;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.resources["gold"]).toBe(110);
    expect(h.state.arcs["linear"]!.history).toEqual(["a"]);
  });

  it("waits on a transition until the world satisfies it, then completes", () => {
    const { h, engine } = run({ linear });
    h.state.day = 2;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["linear"]!.stage).toBe("a");

    h.state.flags["go"] = true;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["linear"]).toMatchObject({
      stage: "b",
      completed: true,
      outcome: "finished",
      history: ["a", "b"],
    });
    expect(messages(h.log)).toContain("[Linear] concludes — finished.");
  });

  it("hides options whose requirements fail", () => {
    const { h, engine } = run({ branch: branching });
    h.state.arcs["branch"] = {
      arcId: "branch", stage: "fork", startedDay: 0, completed: false, history: [],
    };
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.flags["walked"]).toBe(true);
    expect(h.state.arcs["branch"]!.outcome).toBe("walked");
  });

  it("explains the gate on an option the player cannot take", () => {
    const { h, engine } = run({ branch: branching });
    h.state.arcs["branch"] = {
      arcId: "branch", stage: "fork", startedDay: 0, completed: false, history: [],
    };
    const seen: string[] = [];
    engine.tick(h.state, new Rng("a"), h.log, (prompt) => {
      for (const option of prompt.options) {
        seen.push(`${option.id}:${option.available}:${option.requirement ?? "-"}`);
      }
      return prompt.options.find((o) => o.available)!.id;
    });
    expect(seen).toEqual(["rich:false:gold >= 200", "cheap:true:-"]);
  });

  it("takes a gated option once it becomes affordable", () => {
    const { h, engine } = run({ branch: branching });
    h.state.resources["gold"] = 200;
    h.state.arcs["branch"] = {
      arcId: "branch", stage: "fork", startedDay: 0, completed: false, history: [],
    };
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["branch"]!.outcome).toBe("paid");
  });

  it("follows a scripted chooser, falling back when the script does not apply", () => {
    const { h, engine } = run({ branch: branching });
    h.state.resources["gold"] = 200;
    h.state.arcs["branch"] = {
      arcId: "branch", stage: "fork", startedDay: 0, completed: false, history: [],
    };
    engine.tick(h.state, new Rng("a"), h.log, scripted({ "branch:fork": "cheap" }));
    expect(h.state.arcs["branch"]!.outcome).toBe("walked");
  });

  it("ignores a scripted choice that is not currently available", () => {
    const { h, engine } = run({ branch: branching });
    h.state.arcs["branch"] = {
      arcId: "branch", stage: "fork", startedDay: 0, completed: false, history: [],
    };
    engine.tick(h.state, new Rng("a"), h.log, scripted({ branch: "rich" }));
    expect(h.state.arcs["branch"]!.outcome).toBe("walked");
  });

  it("only ever returns available options from the random chooser", () => {
    for (let i = 0; i < 40; i++) {
      const { h, engine } = run({ branch: branching });
      h.state.arcs["branch"] = {
        arcId: "branch", stage: "fork", startedDay: 0, completed: false, history: [],
      };
      engine.tick(h.state, new Rng(`s${i}`), h.log, randomChoice);
      expect(h.state.arcs["branch"]!.outcome).toBe("walked");
    }
  });

  it("falls through to transitions when no option is available", () => {
    const stuck: Arc = {
      id: "stuck",
      title: "Stuck",
      summary: "",
      start: "gate",
      stages: {
        gate: {
          id: "gate",
          text: "gate",
          choices: [{ id: "no", text: "no", requires: { kind: "never" }, goto: "out" }],
          transitions: [{ requires: { kind: "flag", flag: "open" }, goto: "out" }],
        },
        out: { id: "out", text: "out", terminal: true, outcome: "out" },
      },
    };
    const { h, engine } = run({ stuck });
    h.state.arcs["stuck"] = {
      arcId: "stuck", stage: "gate", startedDay: 0, completed: false, history: [],
    };
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["stuck"]!.completed).toBe(false);

    h.state.flags["open"] = true;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["stuck"]!.outcome).toBe("out");
  });

  it("closes out a terminal stage even when the run ends mid-choice", () => {
    const ending: Arc = {
      id: "ending",
      title: "Ending",
      summary: "",
      start: "rite",
      stages: {
        rite: {
          id: "rite",
          text: "the rite",
          choices: [
            {
              id: "seal",
              text: "seal it",
              effects: [{ kind: "endRun", status: "victory", reason: "sealed" }],
              goto: "done",
            },
          ],
        },
        done: { id: "done", text: "it is done", terminal: true, outcome: "sealed" },
      },
    };
    const { h, engine } = run({ ending });
    h.state.arcs["ending"] = {
      arcId: "ending", stage: "rite", startedDay: 0, completed: false, history: [],
    };
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);

    expect(h.state.status).toBe("victory");
    expect(h.state.arcs["ending"]).toMatchObject({ completed: true, outcome: "sealed" });
  });

  it("does not open new branches after the run has ended", () => {
    const { h, engine } = run({ branch: branching });
    h.state.arcs["branch"] = {
      arcId: "branch", stage: "fork", startedDay: 0, completed: false, history: [],
    };
    h.state.status = "defeat";
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(h.state.arcs["branch"]!.completed).toBe(false);
    expect(h.state.flags["walked"]).toBeUndefined();
  });

  it("reports a stage cycle instead of spinning forever", () => {
    const loop: Arc = {
      id: "loop",
      title: "Loop",
      summary: "",
      start: "a",
      stages: {
        a: { id: "a", text: "a", transitions: [{ requires: { kind: "always" }, goto: "b" }] },
        b: { id: "b", text: "b", transitions: [{ requires: { kind: "always" }, goto: "a" }] },
      },
    };
    const { h, engine } = run({ loop });
    h.state.arcs["loop"] = {
      arcId: "loop", stage: "a", startedDay: 0, completed: false, history: [],
    };
    expect(() => engine.tick(h.state, new Rng("a"), h.log, firstAvailable))
      .toThrow(/did not settle/);
  });

  it("reports a transition that points at a missing stage", () => {
    const broken: Arc = {
      id: "broken",
      title: "Broken",
      summary: "",
      start: "a",
      stages: {
        a: { id: "a", text: "a", transitions: [{ requires: { kind: "always" }, goto: "ghost" }] },
      },
    };
    const { h, engine } = run({ broken });
    h.state.arcs["broken"] = {
      arcId: "broken", stage: "a", startedDay: 0, completed: false, history: [],
    };
    expect(() => engine.tick(h.state, new Rng("a"), h.log, firstAvailable))
      .toThrow(/missing stage "ghost"/);
  });

  it("lists only the arcs still in progress", () => {
    const { h, engine } = run({ linear });
    h.state.day = 2;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(engine.activeArcs(h.state).map((a) => a.arcId)).toEqual(["linear"]);

    h.state.flags["go"] = true;
    engine.tick(h.state, new Rng("a"), h.log, firstAvailable);
    expect(engine.activeArcs(h.state)).toEqual([]);
  });
});
