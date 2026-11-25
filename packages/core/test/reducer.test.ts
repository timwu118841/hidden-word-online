import { describe, expect, it } from "vitest";
import { reduce } from "../src/reducer";
import { viewFor } from "../src/view";
import {
  HINT_WORDS,
  Harness,
  T0,
  WRONG_GUESS,
  defaultEnvelopes,
  finishTurnWithoutHints,
  pickAll,
  playStage,
  scoreHint,
  setterOf,
  skipStage,
  stageOf,
  submitHint,
  submitReveal,
} from "./helpers";

/** Started game sitting in the hint phase of the first turn. */
function hintTurn(count = 2): Harness {
  const h = new Harness("quick", count, { start: true });
  pickAll(h);
  expect(h.state.phase).toBe("hint");
  return h;
}

describe("lobby and start", () => {
  it("creates a lobby with the host in seat 0", () => {
    const h = new Harness("quick", 1, { ready: false });
    expect(h.state.phase).toBe("lobby");
    expect(h.state.hostId).toBe("p1");
    expect(h.state.players).toHaveLength(1);
    expect(h.player("p1")).toMatchObject({ seat: 0, ready: false, score: 0, pieces: 1 });
    expect(h.state.deadline).toBeNull();
  });

  it("validates the host, player count and readiness before starting", () => {
    const solo = new Harness("quick", 1, { ready: false });
    const before = solo.state;
    const tooFew = solo.attempt({ type: "START", by: "p1", envelopes: {} });
    expect(tooFew.error).toBe("not_enough_players");
    expect(tooFew.state).toBe(before);

    const two = new Harness("quick", 2, { ready: false });
    expect(two.attempt({ type: "START", by: "p2", envelopes: {} }).error).toBe("not_host");
    expect(two.attempt({ type: "START", by: "p1", envelopes: {} }).error).toBe("not_all_ready");

    two.dispatch({ type: "SET_READY", playerId: "p1", ready: true });
    expect(two.attempt({ type: "START", by: "p1", envelopes: {} }).error).toBe("not_all_ready");
    two.dispatch({ type: "SET_READY", playerId: "p2", ready: true });

    two.dispatch({
      type: "START",
      by: "p1",
      envelopes: defaultEnvelopes(["p1", "p2"], 1),
    });
    expect(two.state.phase).toBe("pick");
    expect(two.state.turnIndex).toBe(0);

    expect(two.attempt({ type: "START", by: "p1", envelopes: {} }).error).toBe("wrong_phase");
    expect(two.attempt({ type: "SET_READY", playerId: "p1", ready: false }).error).toBe(
      "wrong_phase",
    );
    expect(two.attempt({ type: "JOIN", playerId: "p3", name: "玩家3" }).error).toBe(
      "game_started",
    );
  });

  it("fills up to maxPlayers", () => {
    const h = new Harness("quick", 7, { ready: false });
    expect(h.attempt({ type: "JOIN", playerId: "p8", name: "玩家8" }).error).toBe("room_full");
  });

  it("removes an unresponsive lobby player once the grace period lapses", () => {
    const h = new Harness("quick", 3, { ready: false });
    h.dispatch({ type: "DISCONNECT", playerId: "p3" });
    h.dispatch({ type: "AWAY_TIMEOUT", playerId: "p3", connSeq: h.player("p3").connSeq });
    expect(h.playerIds).toEqual(["p1", "p2"]);

    h.dispatch({ type: "LEAVE", playerId: "p1" });
    expect(h.state.hostId).toBe("p2");
    h.dispatch({ type: "LEAVE", playerId: "p2" });
    expect(h.playerIds).toEqual([]);
    expect(h.state.hostId).toBe("");

    h.dispatch({ type: "JOIN", playerId: "p9", name: "玩家9" });
    expect(h.state.hostId).toBe("p9");
    expect(h.player("p9").seat).toBe(0);
  });

  it("kicks in the lobby only and hands the host seat on when the host leaves", () => {
    const h = new Harness("quick", 3, { ready: false });
    expect(h.attempt({ type: "KICK", by: "p2", target: "p3" }).error).toBe("not_host");
    expect(h.attempt({ type: "KICK", by: "p1", target: "p1" }).error).toBe("bad_request");
    expect(h.attempt({ type: "KICK", by: "p1", target: "p9" }).error).toBe("unknown_player");

    h.dispatch({ type: "KICK", by: "p1", target: "p2" });
    expect(h.playerIds).toEqual(["p1", "p3"]);
    expect(h.player("p3").seat).toBe(1);

    h.dispatch({ type: "LEAVE", playerId: "p1" });
    expect(h.playerIds).toEqual(["p3"]);
    expect(h.state.hostId).toBe("p3");
    expect(h.player("p3").seat).toBe(0);
  });
});

describe("pick phase", () => {
  it("only accepts envelope words, normalizes them, and picks once", () => {
    const h = new Harness("quick", 2, { start: true });
    const p1 = h.player("p1");

    expect(h.attempt({ type: "PICK_WORD", playerId: "p1", word: "鉛筆" }).error).toBe(
      "not_in_envelope",
    );
    // p1's envelope[0] is 蘋果; a Simplified submission must match.
    h.dispatch({ type: "PICK_WORD", playerId: "p1", word: "苹果" });
    expect(h.hidden("p1")).toBe("蘋果");
    expect(h.attempt({ type: "PICK_WORD", playerId: "p1", word: p1.envelope[1]! }).error).toBe(
      "already_picked",
    );
    expect(h.state.phase).toBe("pick");
  });

  it("auto-picks for every unpicked player when the pick timer expires", () => {
    const h = new Harness("quick", 2, { start: true });
    const envelopes = h.state.players.map((p) => [...p.envelope]);

    h.dispatch({ type: "PICK_WORD", playerId: "p1", word: envelopes[0]![3]! });
    expect(h.state.phase).toBe("pick");

    h.timeout(0.5);
    expect(h.hidden("p1")).toBe(envelopes[0]![3]);
    expect(h.hidden("p2")).toBe(envelopes[1]![2]); // floor(0.5 * 5)
    expect(h.state.phase).toBe("hint");
    expect(setterOf(h)).toBe("p1");
    expect(stageOf(h).index).toBe(0);
  });

  it("fills away players with their first envelope word when everyone active picked", () => {
    const h = new Harness("quick", 3, { start: true });
    const p3Envelope = [...h.player("p3").envelope];

    h.dispatch({ type: "DISCONNECT", playerId: "p3" });
    h.dispatch({ type: "AWAY_TIMEOUT", playerId: "p3", connSeq: h.player("p3").connSeq });
    expect(h.state.phase).toBe("pick");

    h.dispatch({ type: "PICK_WORD", playerId: "p1", word: h.player("p1").envelope[0]! });
    expect(h.state.phase).toBe("pick");
    h.dispatch({ type: "PICK_WORD", playerId: "p2", word: h.player("p2").envelope[0]! });

    expect(h.hidden("p3")).toBe(p3Envelope[0]);
    expect(h.state.phase).toBe("hint");
    expect(setterOf(h)).toBe("p1");
  });
});

describe("hint validation", () => {
  it("records format / contains / duplicate / not-noun rejections without consuming slots", () => {
    const h = hintTurn(2);
    const hidden = h.hidden("p1")!;

    h.dispatch({ type: "SUBMIT_HINT", playerId: "p1", word: "hello!!" });
    expect(stageOf(h).hints.at(-1)).toMatchObject({ status: "rejected", reason: "format" });

    h.dispatch({ type: "SUBMIT_HINT", playerId: "p1", word: hidden });
    expect(stageOf(h).hints.at(-1)).toMatchObject({
      status: "rejected",
      reason: "contains_hidden",
    });

    h.dispatch({ type: "SUBMIT_HINT", playerId: "p1", word: hidden.slice(0, 1) });
    expect(stageOf(h).hints.at(-1)).toMatchObject({
      status: "rejected",
      reason: "contains_hidden",
    });

    const first = submitHint(h, "醫生");
    scoreHint(h, first.id, 40);

    // A rejected hint of any kind does not consume the slot, and duplicates are
    // detected across stages of the same turn on normalized text.
    h.dispatch({ type: "SUBMIT_HINT", playerId: "p1", word: "医生" });
    expect(stageOf(h).hints.at(-1)).toMatchObject({
      status: "rejected",
      reason: "duplicate",
    });

    h.dispatch({ type: "SUBMIT_HINT", playerId: "p1", word: "醫院" });
    const notNoun = stageOf(h).hints.at(-1)!;
    expect(notNoun.status).toBe("pending");
    scoreHint(h, notNoun.id, 30, false);
    expect(stageOf(h).hints.at(-1)).toMatchObject({ status: "rejected", reason: "not_noun" });

    expect(stageOf(h).hints.filter((hint) => hint.status === "scored")).toHaveLength(1);
    const after = submitHint(h, "護士");
    expect(after.status).toBe("pending");
  });

  it("refuses a second hint while one is pending", () => {
    const h = hintTurn(2);
    submitHint(h, "醫生");
    expect(h.attempt({ type: "SUBMIT_HINT", playerId: "p1", word: "醫院" }).error).toBe(
      "hint_pending",
    );
    expect(h.attempt({ type: "SUBMIT_HINT", playerId: "p2", word: "醫院" }).error).toBe(
      "not_your_turn",
    );
  });

  it("refuses hints past the per-stage cap", () => {
    const h = hintTurn(2);
    const forged = structuredClone(h.state);
    const stage = forged.turn!.stages[0]!;
    stage.hints = HINT_WORDS.slice(0, 5).map((word, index) => ({
      id: `f${index}`,
      word,
      status: "scored" as const,
      score: 40,
      reason: null,
      submittedAt: T0 + index,
    }));

    const result = reduce(forged, { type: "SUBMIT_HINT", playerId: "p1", word: "藥局" }, T0);
    expect(result.error).toBe("hint_cap");
    expect(result.state).toBe(forged);
  });

  it("ends the stage once the capped hint resolves and reveals the best", () => {
    const h = hintTurn(2);
    for (let index = 0; index < 5; index += 1) {
      const hint = submitHint(h, HINT_WORDS[index]!);
      expect(hint.status).toBe("pending");
      scoreHint(h, hint.id, 40 + index);
    }
    expect(h.state.phase).toBe("guess");
    const stage = stageOf(h);
    expect(stage.stopRequested).toBe(true);
    expect(stage.hints).toHaveLength(5);
    expect(stage.revealedHintId).toBe(stage.hints[4]!.id);
  });
});

describe("hint phase end conditions", () => {
  it("ends immediately on a hint at the instant threshold", () => {
    const h = hintTurn(2);
    const hint = submitHint(h, "醫生");
    scoreHint(h, hint.id, 95);
    expect(h.state.phase).toBe("guess");
    expect(stageOf(h).revealedHintId).toBe(hint.id);
    expect(stageOf(h).revealedHintId).toBe(stageOf(h).hints[0]!.id);

    const late = new Harness("quick", 2, { start: true });
    pickAll(late);
    const low = submitHint(late, "醫生");
    scoreHint(late, low.id, 94);
    expect(late.state.phase).toBe("hint");
    late.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    expect(late.state.phase).toBe("guess");
    expect(late.attempt({ type: "STOP_HINTS", playerId: "p1" }).error).toBe("wrong_phase");
  });

  it("defers the setter's stop until the pending hint resolves", () => {
    const h = hintTurn(2);
    const hint = submitHint(h, "醫生");
    h.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    expect(h.state.phase).toBe("hint");
    expect(stageOf(h).stopRequested).toBe(true);

    scoreHint(h, hint.id, 50);
    expect(h.state.phase).toBe("guess");
    expect(stageOf(h).revealedHintId).toBe(hint.id);
  });

  it("ends the hint phase at once when nothing is pending", () => {
    const h = hintTurn(2);
    h.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    expect(h.state.phase).toBe("result");
    expect(stageOf(h).revealedHintId).toBeNull();
    expect(stageOf(h).resolved).toBe(true);
  });

  it("ignores stale hint results", () => {
    const h = hintTurn(2);
    const hint = submitHint(h, "醫生");
    scoreHint(h, hint.id, 96);
    const before = h.state;

    expect(h.attempt({ type: "HINT_SCORED", hintId: hint.id, score: 10, isNoun: true }).state).toBe(
      before,
    );
    expect(
      h.attempt({ type: "HINT_FAILED", hintId: "h99", reason: "scorer_error" }).state,
    ).toBe(before);

    // A new stage in the same turn must not accept the previous stage's hint id.
    h.timeout(); // guess timer -> result
    h.timeout(); // result timer -> stage 1 hint
    expect(h.state.phase).toBe("hint");
    expect(h.attempt({ type: "HINT_SCORED", hintId: hint.id, score: 99, isNoun: true }).state).toBe(
      h.state,
    );
  });

  it("reveals the highest score, breaking ties by submission time then position", () => {
    const h = hintTurn(2);
    const early = submitHint(h, "醫生");
    scoreHint(h, early.id, 70);
    h.advance(5_000);
    const late = submitHint(h, "醫院");
    scoreHint(h, late.id, 70);
    h.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    expect(stageOf(h).revealedHintId).toBe(early.id);

    const sameTime = hintTurn(2);
    const first = submitHint(sameTime, "醫生");
    scoreHint(sameTime, first.id, 70);
    const second = submitHint(sameTime, "醫院");
    scoreHint(sameTime, second.id, 70);
    sameTime.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    expect(stageOf(sameTime).revealedHintId).toBe(first.id);

    const higher = hintTurn(2);
    const low = submitHint(higher, "醫生");
    scoreHint(higher, low.id, 70);
    higher.advance(5_000);
    const high = submitHint(higher, "醫院");
    scoreHint(higher, high.id, 80);
    higher.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    expect(stageOf(higher).revealedHintId).toBe(high.id);
  });
});

describe("no-reveal stage and setter points", () => {
  it("drops a pending hint, skips the guess phase and pays the setter nothing", () => {
    const h = hintTurn(2);
    const pending = submitHint(h, "醫生");
    expect(pending.status).toBe("pending");

    h.timeout(); // hint timer
    expect(h.state.phase).toBe("result");
    expect(stageOf(h).hints[0]!.status).toBe("dropped");
    expect(stageOf(h).revealedHintId).toBeNull();
    expect(stageOf(h).guesses).toEqual({});
    expect(stageOf(h).setterGain).toBe(0);
    expect(h.score("p1")).toBe(0);

    h.timeout(); // result timer
    expect(h.state.phase).toBe("hint");
    expect(stageOf(h).index).toBe(1);
  });

  it("pays nothing for a reveal under 60 and stage points from 60 up", () => {
    const h = hintTurn(2);
    playStage(h, "醫生", 59, "wrong");
    expect(h.state.phase).toBe("hint");
    expect(h.score("p1")).toBe(0);
    expect(h.state.turn!.stages[0]!.resolved).toBe(true);

    playStage(h, "醫院", 60, "wrong");
    expect(h.score("p1")).toBe(2); // setterStagePoints[1]
    expect(h.state.turn!.stages[1]!.setterGain).toBe(2);
  });

  it("pays the stage-index points and doubles them in round two", () => {
    const h = new Harness("full", 2, { start: true });

    pickAll(h);
    expect(setterOf(h)).toBe("p1");
    playStage(h, "醫生", 80, "correct"); // p2 guesses it: +1 in round 1
    expect(h.score("p2")).toBe(1);
    expect(h.state.history.at(-1)).toMatchObject({ setterId: "p1", outcome: "guessed" });

    expect(setterOf(h)).toBe("p2");
    playStage(h, "醫院", 70, "wrong"); // +1
    expect(h.score("p2")).toBe(2);
    playStage(h, "護士", 70, "wrong"); // +2
    expect(h.score("p2")).toBe(4);
    playStage(h, "藥師", 70, "wrong"); // +3, last stage
    expect(h.score("p2")).toBe(7);
    expect(h.state.phase).toBe("pick");
    expect(h.state.round).toBe(1);

    pickAll(h);
    expect(setterOf(h)).toBe("p1");
    playStage(h, "病房", 80, "correct"); // +2 in round 2
    expect(h.score("p2")).toBe(9);

    expect(setterOf(h)).toBe("p2");
    playStage(h, "診所", 70, "wrong"); // 1 × 2
    expect(h.score("p2")).toBe(11);
    playStage(h, "手術", 70, "wrong"); // 2 × 2
    expect(h.score("p2")).toBe(15);
    playStage(h, "急診", 70, "wrong"); // 3 × 2
    expect(h.score("p2")).toBe(21);

    expect(h.state.phase).toBe("final");
    expect(h.state.endReason).toBe("completed");
    expect(h.score("p1")).toBe(0);
  });
});

describe("guess phase", () => {
  it("ends as soon as every active guesser submitted", () => {
    const h = hintTurn(3);
    submitReveal(h, "醫生", 80);
    expect(h.state.phase).toBe("guess");

    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p2", words: [WRONG_GUESS] });
    expect(h.state.phase).toBe("guess");

    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p3", words: [] });
    expect(h.state.phase).toBe("result");
    expect(stageOf(h).resolved).toBe(true);
    expect(stageOf(h).guesses["p3"]!.words).toEqual([]);
  });

  it("rejects the setter, repeated submissions, and two answers without a Piece", () => {
    const h = hintTurn(3);
    submitReveal(h, "醫生", 80);
    expect(h.state.phase).toBe("guess");

    expect(h.attempt({ type: "SUBMIT_GUESS", playerId: "p1", words: [WRONG_GUESS] }).error).toBe(
      "not_your_turn",
    );
    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p2", words: [WRONG_GUESS] });
    expect(h.attempt({ type: "SUBMIT_GUESS", playerId: "p2", words: [WRONG_GUESS] }).error).toBe(
      "already_guessed",
    );

    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p3", words: [WRONG_GUESS, WRONG_GUESS] });
    expect(h.state.phase).toBe("result");
  });

  it("accepts a Simplified answer for a Traditional hidden word", () => {
    const envelopes = {
      p1: [["醫院", "蘋果", "香蕉", "橘子", "葡萄"]],
      p2: [["鳳梨", "草莓", "櫻桃", "檸檬", "芒果"]],
    };
    const h = new Harness("quick", 2, { start: true, envelopes });
    h.dispatch({ type: "PICK_WORD", playerId: "p1", word: "醫院" });
    h.dispatch({ type: "PICK_WORD", playerId: "p2", word: "鳳梨" });

    // A Simplified hint that normalizes to the hidden word is refused outright.
    expect(h.attempt({ type: "SUBMIT_HINT", playerId: "p1", word: "医院" }).error).toBeUndefined();
    expect(stageOf(h).hints.at(-1)).toMatchObject({
      status: "rejected",
      reason: "contains_hidden",
    });

    const hint = submitHint(h, "醫生");
    scoreHint(h, hint.id, 80);
    h.dispatch({ type: "STOP_HINTS", playerId: "p1" });
    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p2", words: ["医院"] });

    expect(stageOf(h).guesses["p2"]!.correct).toBe(true);
    expect(h.score("p2")).toBe(1);
    expect(h.state.turn!.outcome).toBe("guessed");
  });

  it("spends one Piece per turn and refuses a second use", () => {
    const h = hintTurn(3);
    const spend = (): void => {
      const hint = submitHint(h, HINT_WORDS[stageOf(h).index + 10]!);
      scoreHint(h, hint.id, 80);
      h.dispatch({ type: "STOP_HINTS", playerId: setterOf(h) });
    };

    spend();
    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p2", words: ["點滴", "處方"] });
    expect(h.player("p2").pieces).toBe(0);
    expect(stageOf(h).guesses["p2"]!.words).toEqual(["點滴", "處方"]);
    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p3", words: [WRONG_GUESS] });
    expect(h.state.phase).toBe("result");
    h.timeout();

    // Stage 1 of the same turn: the Piece is already spent.
    spend();
    expect(h.attempt({ type: "SUBMIT_GUESS", playerId: "p2", words: ["點滴", "處方"] }).error).toBe(
      "piece_used",
    );
    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p2", words: [WRONG_GUESS] });
    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p3", words: [WRONG_GUESS] });
    h.timeout();

    finishTurnWithoutHints(h); // stage 2 of turn 1
    expect(setterOf(h)).toBe("p2");
    finishTurnWithoutHints(h); // turn 2
    expect(setterOf(h)).toBe("p3");
    const hint = submitHint(h, "復健");
    scoreHint(h, hint.id, 80);
    h.dispatch({ type: "STOP_HINTS", playerId: setterOf(h) });
    expect(h.attempt({ type: "SUBMIT_GUESS", playerId: "p2", words: ["點滴", "處方"] }).error).toBe(
      "no_piece",
    );
  });
});

describe("presence", () => {
  it("ignores an away timeout fired for a stale connection sequence", () => {
    const h = hintTurn(3);
    const disconnect = h.dispatch({ type: "DISCONNECT", playerId: "p3" });
    const timer = disconnect.effects.find((effect) => effect.type === "setAwayTimer");
    expect(timer).toBeDefined();
    const staleSeq = timer?.type === "setAwayTimer" ? timer.connSeq : -1;

    h.dispatch({ type: "CONNECT", playerId: "p3" });
    const before = h.state;
    const stale = h.attempt({ type: "AWAY_TIMEOUT", playerId: "p3", connSeq: staleSeq });
    expect(stale.error).toBeUndefined();
    expect(stale.state).toBe(before);
    expect(h.player("p3").away).toBe(false);

    h.dispatch({ type: "DISCONNECT", playerId: "p3" });
    h.dispatch({ type: "AWAY_TIMEOUT", playerId: "p3", connSeq: h.player("p3").connSeq });
    expect(h.player("p3").away).toBe(true);
    expect(h.player("p3").connected).toBe(false);
    expect(h.state.phase).not.toBe("final");
  });

  it("does not let an away guesser block the early end", () => {
    const h = hintTurn(3);
    submitReveal(h, "醫生", 80);
    expect(h.state.phase).toBe("guess");

    h.dispatch({ type: "DISCONNECT", playerId: "p3" });
    h.dispatch({ type: "AWAY_TIMEOUT", playerId: "p3", connSeq: h.player("p3").connSeq });
    expect(h.state.phase).toBe("guess");

    h.dispatch({ type: "SUBMIT_GUESS", playerId: "p2", words: [WRONG_GUESS] });
    expect(h.state.phase).toBe("result");
  });

  it("ends the turn when the setter goes away mid-turn", () => {
    const h = hintTurn(3);
    const setter = setterOf(h);
    submitHint(h, "醫生");

    h.dispatch({ type: "DISCONNECT", playerId: setter });
    const away = h.dispatch({
      type: "AWAY_TIMEOUT",
      playerId: setter,
      connSeq: h.player(setter).connSeq,
    });

    expect(away.effects.some((effect) => effect.type === "setTimer")).toBe(true);
    expect(h.state.phase).toBe("result");
    expect(h.state.turn!.outcome).toBe("setter_away");
    expect(stageOf(h).hints[0]!.status).toBe("dropped");
    expect(h.state.history.at(-1)).toMatchObject({
      setterId: setter,
      outcome: "setter_away",
      hiddenWord: h.hidden(setter),
    });
    expect(h.score(setter)).toBe(0);
    expect(h.state.phase).not.toBe("final");
  });

  it("skips an away setter when the next turn starts", () => {
    const h = hintTurn(3);
    h.dispatch({ type: "DISCONNECT", playerId: "p2" });
    h.dispatch({ type: "AWAY_TIMEOUT", playerId: "p2", connSeq: h.player("p2").connSeq });
    expect(setterOf(h)).toBe("p1");

    finishTurnWithoutHints(h);
    expect(setterOf(h)).toBe("p3");
    expect(h.state.turnIndex).toBe(2);
  });

  it("treats a mid-game leave as going away immediately", () => {
    const h = hintTurn(3);
    h.dispatch({ type: "LEAVE", playerId: "p3" });
    expect(h.player("p3")).toMatchObject({ away: true, connected: false });
    expect(h.state.players).toHaveLength(3);
  });

  it("ends the game when fewer than two players are active", () => {
    const h = hintTurn(3);

    h.dispatch({ type: "DISCONNECT", playerId: "p2" });
    h.dispatch({ type: "AWAY_TIMEOUT", playerId: "p2", connSeq: h.player("p2").connSeq });
    expect(h.state.phase).not.toBe("final");

    h.dispatch({ type: "DISCONNECT", playerId: "p3" });
    const result = h.dispatch({
      type: "AWAY_TIMEOUT",
      playerId: "p3",
      connSeq: h.player("p3").connSeq,
    });

    expect(h.state.phase).toBe("final");
    expect(h.state.endReason).toBe("not_enough_players");
    expect(result.effects.map((effect) => effect.type)).toEqual(
      expect.arrayContaining(["clearTimer", "gameOver"]),
    );
    const p1 = viewFor(h.state, "p1");
    expect(p1.final!.endReason).toBe("not_enough_players");
  });
});

describe("full games", () => {
  it("plays a quick game to a final ranking", () => {
    const h = new Harness("quick", 2, { start: true });
    pickAll(h);
    const hidden = { p1: h.hidden("p1"), p2: h.hidden("p2") };

    skipStage(h); // p1 stage 0: no reveal -> 0
    skipStage(h); // p1 stage 1: no reveal -> 0
    playStage(h, "醫生", 70, "wrong"); // p1 stage 2: +3, last stage
    expect(setterOf(h)).toBe("p2");

    skipStage(h); // p2 stage 0
    skipStage(h); // p2 stage 1
    skipStage(h); // p2 stage 2 -> final

    expect(h.state.phase).toBe("final");
    expect(h.state.endReason).toBe("completed");
    expect(h.score("p1")).toBe(3);

    const view = h.view("p1");
    expect(view.final).toEqual({
      ranking: [
        { playerId: "p1", rank: 1, score: 3 },
        { playerId: "p2", rank: 2, score: 0 },
      ],
      endReason: "completed",
      hiddenWords: hidden,
    });
  });

  it("shares ranks on tied scores", () => {
    const h = new Harness("quick", 2, { start: true });
    pickAll(h);
    for (let index = 0; index < 6; index += 1) skipStage(h);

    expect(h.state.phase).toBe("final");
    expect(h.view("p1").final!.ranking).toEqual([
      { playerId: "p1", rank: 1, score: 0 },
      { playerId: "p2", rank: 1, score: 0 },
    ]);
  });

  it("plays three players through turns and a piece to the final", () => {
    const h = hintTurn(3);
    playStage(h, "醫生", 85, "correct");
    expect(h.score("p2")).toBe(1);
    expect(h.score("p3")).toBe(1);

    expect(setterOf(h)).toBe("p2");
    playStage(h, "醫院", 70, "wrong");
    playStage(h, "護士", 70, "wrong");
    playStage(h, "藥師", 70, "wrong");
    expect(h.score("p2")).toBe(7); // 1 as a guesser + 1 + 2 + 3 as setter

    expect(setterOf(h)).toBe("p3");
    skipStage(h);
    skipStage(h);
    skipStage(h);

    expect(h.state.phase).toBe("final");
    expect(h.view("p3").final!.ranking).toEqual([
      { playerId: "p2", rank: 1, score: 7 },
      { playerId: "p3", rank: 2, score: 1 },
      { playerId: "p1", rank: 3, score: 0 },
    ]);
  });
});

describe("immutability", () => {
  it("never mutates the input state", () => {
    const h = hintTurn(2);
    const before = h.state;
    const frozen = structuredClone(before);
    const result = h.dispatch({ type: "SUBMIT_HINT", playerId: "p1", word: "醫生" });
    expect(result.state).not.toBe(before);
    expect(before).toEqual(frozen);
  });

  it("returns the caller's state untouched for an invalid intent", () => {
    const h = hintTurn(2);
    const before = h.state;
    const result = h.attempt({ type: "PICK_WORD", playerId: "p1", word: "蘋果" });
    expect(result.error).toBe("wrong_phase");
    expect(result.state).toBe(before);
  });
});
