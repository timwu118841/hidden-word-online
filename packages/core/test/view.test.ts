import { describe, expect, it } from "vitest";
import type { GameState, PlayerId } from "../src/types";
import { viewFor } from "../src/view";
import {
  Harness,
  guessAll,
  pickAll,
  playStage,
  scoreHint,
  setterOf,
  skipStage,
  submitHint,
} from "./helpers";

/**
 * Everything a given player must not be able to read out of their view.
 *
 * Envelope words stay secret even after the owner's turn ends (only the hidden
 * word becomes public); words that are already public through history or the
 * final screen are excluded.
 */
function secretsIn(state: GameState, viewerId: PlayerId): string[] {
  const publicWords = new Set<string>();
  for (const entry of state.history) {
    publicWords.add(entry.hiddenWord);
    for (const reveal of entry.revealed) publicWords.add(reveal.word);
  }
  if (state.phase === "final") {
    for (const player of state.players) {
      if (player.hiddenWord) publicWords.add(player.hiddenWord);
    }
  }

  const secrets = new Set<string>();
  for (const [id, rounds] of Object.entries(state.envelopes)) {
    if (id === viewerId) continue;
    for (const words of rounds) {
      for (const word of words) {
        if (!publicWords.has(word)) secrets.add(word);
      }
    }
  }
  if (state.phase !== "final") {
    for (const player of state.players) {
      if (player.id === viewerId || !player.hiddenWord) continue;
      if (!publicWords.has(player.hiddenWord)) secrets.add(player.hiddenWord);
    }
  }

  const turn = state.turn;
  // The viewer's own submitted words are legitimately in their view (`myGuess`),
  // even when they happen to be somebody else's hidden word.
  const ownWords = new Set<string>();
  if (turn) {
    for (const stage of turn.stages) {
      const mine = stage.guesses[viewerId];
      if (mine) for (const word of mine.words) ownWords.add(word);
    }
  }

  if (turn && turn.setterId !== viewerId) {
    for (const stage of turn.stages) {
      for (const hint of stage.hints) {
        if (stage.revealedHintId === hint.id) continue;
        if (!publicWords.has(hint.word)) secrets.add(hint.word);
      }
      if (!stage.resolved) {
        for (const [id, guess] of Object.entries(stage.guesses)) {
          if (id === viewerId) continue;
          for (const word of guess.words) {
            if (!publicWords.has(word)) secrets.add(word);
          }
        }
      }
    }
  }

  return [...secrets].filter((word) => !ownWords.has(word));
}

function assertNoLeaks(h: Harness): void {
  expect(h.snapshots.length).toBeGreaterThan(10);
  for (const state of h.snapshots) {
    for (const player of state.players) {
      const view = viewFor(state, player.id);
      const text = JSON.stringify(view);
      for (const secret of secretsIn(state, player.id)) {
        expect(
          text.includes(secret),
          `leaked "${secret}" to ${player.id} in ${state.phase} (seq ${state.phaseSeq})`,
        ).toBe(false);
      }
      if (state.turn && state.turn.setterId !== player.id && state.turn.outcome === null) {
        expect(view.turn?.hiddenWord ?? null).toBeNull();
      }
    }
  }
}

/** Three players, whole game with hints, a reveal, an away player and a final. */
function scriptedGameA(): Harness {
  const h = new Harness("quick", 3, { start: true });
  pickAll(h);

  playStage(h, "醫生", 80, "wrong"); // p1 stage 0: 醫生 revealed
  playStage(h, "醫院", 70, "correct"); // p1 stage 1: p2 & p3 guess it
  expect(setterOf(h)).toBe("p2");

  h.dispatch({ type: "DISCONNECT", playerId: "p3" });
  h.dispatch({ type: "AWAY_TIMEOUT", playerId: "p3", connSeq: h.player("p3").connSeq });

  const low = submitHint(h, "藥師");
  scoreHint(h, low.id, 40);
  const high = submitHint(h, "護士");
  scoreHint(h, high.id, 90);
  h.dispatch({ type: "STOP_HINTS", playerId: "p2" }); // only 護士 is revealed
  guessAll(h, false); // p1 is the only active guesser
  h.timeout(); // result -> stage 1
  skipStage(h);
  skipStage(h); // last stage; p3 is away so the round ends
  return h;
}

/** Two players, auto-pick, a dropped hint and skipped stages. */
function scriptedGameB(): Harness {
  const h = new Harness("quick", 2, { start: true });
  h.timeout(0.25); // pick timer: everyone gets a random envelope word
  submitHint(h, "診所");
  h.timeout(); // hint timer: the pending hint is dropped
  h.timeout(); // result -> stage 1
  skipStage(h);
  skipStage(h);
  for (let index = 0; index < 3; index += 1) skipStage(h); // p2's turn
  return h;
}

/** Three players, two of them away: ends with not_enough_players. */
function scriptedGameC(): Harness {
  const h = new Harness("quick", 3, { start: true });
  pickAll(h);
  for (const id of ["p2", "p3"]) {
    h.dispatch({ type: "DISCONNECT", playerId: id });
    h.dispatch({ type: "AWAY_TIMEOUT", playerId: id, connSeq: h.player(id).connSeq });
  }
  return h;
}

/** Two players, full mode: round 0 ends and round 1 starts, so history is live. */
function scriptedGameD(): Harness {
  const h = new Harness("full", 2, { start: true });
  pickAll(h);
  playStage(h, "醫生", 80, "correct"); // p1's turn ends at stage 0
  for (let index = 0; index < 3; index += 1) skipStage(h); // p2's turn -> round 1
  expect(h.state.phase).toBe("pick");

  pickAll(h);
  playStage(h, "醫院", 70, "wrong");
  playStage(h, "護士", 70, "correct");
  for (let index = 0; index < 3; index += 1) skipStage(h); // p2's turn -> final
  return h;
}

describe("viewFor redaction", () => {
  it("never leaks envelopes, hidden words, hint words or guesses", () => {
    for (const build of [scriptedGameA, scriptedGameB, scriptedGameC, scriptedGameD]) {
      assertNoLeaks(build());
    }
  });

  it("ends the scripted games in the expected place", () => {
    const a = scriptedGameA();
    expect(a.state.phase).toBe("final");
    expect(a.state.endReason).toBe("completed");

    const b = scriptedGameB();
    expect(b.state.phase).toBe("final");

    const c = scriptedGameC();
    expect(c.state.phase).toBe("final");
    expect(c.state.endReason).toBe("not_enough_players");

    const d = scriptedGameD();
    expect(d.state.phase).toBe("final");
    expect(d.state.endReason).toBe("completed");
    expect(d.state.history).toHaveLength(4);
  });

  it("shows hint words only to the setter until they are revealed", () => {
    const h = new Harness("quick", 3, { start: true });
    pickAll(h);

    const low = submitHint(h, "藥師");
    scoreHint(h, low.id, 40);
    const high = submitHint(h, "護士");
    scoreHint(h, high.id, 90);

    expect(h.view("p1").turn!.stages[0]!.hints.map((hint) => hint.word)).toEqual([
      "藥師",
      "護士",
    ]);
    expect(h.view("p2").turn!.stages[0]!.hints).toEqual([
      { id: low.id, status: "scored", score: 40, word: null, reason: null },
      { id: high.id, status: "scored", score: 90, word: null, reason: null },
    ]);

    h.dispatch({ type: "SUBMIT_HINT", playerId: "p1", word: "hello" });
    expect(h.view("p1").turn!.stages[0]!.hints.at(-1)).toMatchObject({
      status: "rejected",
      reason: "format",
    });
    expect(
      h.view("p2").turn!.stages[0]!.hints.some((hint) => hint.status === "rejected"),
    ).toBe(false);

    h.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    const guesser = h.view("p2");
    expect(guesser.turn!.stages[0]!.hints.map((hint) => hint.word)).toEqual([null, "護士"]);
    expect(guesser.turn!.stages[0]!.revealed).toEqual({ word: "護士", score: 90 });
  });

  it("reveals the hidden word with the turn result and at the final screen", () => {
    const h = new Harness("quick", 2, { start: true });
    pickAll(h);
    const hidden = h.hidden("p1");

    expect(h.view("p1").me.hiddenWord).toBe(hidden);
    expect(h.view("p1").turn!.hiddenWord).toBe(hidden);
    expect(h.view("p2").me.hiddenWord).toBe(h.hidden("p2"));
    expect(h.view("p2").turn!.hiddenWord).toBeNull();

    playStage(h, "醫生", 80, "wrong");
    playStage(h, "醫院", 70, "correct"); // p2 guesses p1's word: turn ends
    expect(h.view("p2").history.at(-1)!.hiddenWord).toBe(hidden);

    for (let index = 0; index < 3; index += 1) skipStage(h); // p2's turn
    expect(h.state.phase).toBe("final");
    expect(h.view("p1").final!.hiddenWords).toEqual({ p1: hidden, p2: h.hidden("p2") });
  });

  it("hides guesses until the stage is resolved", () => {
    const h = new Harness("quick", 3, { start: true });
    pickAll(h);
    const hint = submitHint(h, "醫生");
    scoreHint(h, hint.id, 80);
    h.dispatch({ type: "STOP_HINTS", playerId: "p1" });

    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p2", words: ["點滴"] });
    const before = h.view("p1").turn!.stages[0]!;
    expect(before.guesses).toBeNull();
    expect(before.submittedIds).toEqual(["p2"]);
    expect(h.view("p2").turn!.stages[0]!.myGuess).toEqual(["點滴"]);
    expect(h.view("p3").turn!.stages[0]!.myGuess).toBeNull();

    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p3", words: [] });
    const after = h.view("p1").turn!.stages[0]!;
    expect(after.resolved).toBe(true);
    expect(after.guesses).toEqual([
      { playerId: "p2", words: ["點滴"], correct: false },
      { playerId: "p3", words: [], correct: false },
    ]);
  });

  it("only exposes the viewer's own envelope and marks the host", () => {
    const h = new Harness("quick", 3, { start: true });
    const view = h.view("p2");
    expect(view.me.envelope).toEqual(h.player("p2").envelope);
    expect(view.me.isHost).toBe(false);
    expect(view.players.map((player) => player.isHost)).toEqual([true, false, false]);
    expect(view.players.map((player) => player.hasPicked)).toEqual([false, false, false]);
    expect(view.serverNow).toBe(0);
    expect(view.totalRounds).toBe(1);
    expect(view.turnCount).toBe(3);
    expect(view.final).toBeNull();
  });

  it("refuses to build a view for an unknown player", () => {
    const h = new Harness("quick", 2, { ready: false });
    expect(() => viewFor(h.state, "ghost")).toThrow(/unknown player/);
  });
});
