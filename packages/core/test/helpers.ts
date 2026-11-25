import { MODE_PRESETS, type GameMode } from "../src/config";
import { createGame, reduce } from "../src/reducer";
import type {
  GameEvent,
  GameState,
  Hint,
  Player,
  PlayerId,
  PlayerView,
  ReduceResult,
  Stage,
} from "../src/types";
import { viewFor } from "../src/view";

export const T0 = 1_700_000_000_000;

/**
 * Test word pools.
 *
 * Every word is 2 Han characters and unique across all pools, so a word can never
 * appear inside another one. That lets the view tests compare serialized views
 * with plain substring checks without false positives.
 */
export const ROUND1: readonly (readonly string[])[] = [
  ["蘋果", "香蕉", "橘子", "葡萄", "西瓜"],
  ["鳳梨", "草莓", "櫻桃", "檸檬", "芒果"],
  ["椰子", "冬瓜", "南瓜", "茄子", "蘿蔔"],
  ["番茄", "洋蔥", "大蒜", "生薑", "菠菜"],
  ["芹菜", "韭菜", "花椰", "豌豆", "蠶豆"],
  ["紅豆", "綠豆", "黃豆", "玉米", "小麥"],
  ["海帶", "紫菜", "香菇", "木耳", "竹筍"],
];

export const ROUND2: readonly (readonly string[])[] = [
  ["鉛筆", "橡皮", "尺子", "書包", "課本"],
  ["黑板", "粉筆", "講桌", "作業", "考試"],
  ["教室", "操場", "走廊", "禮堂", "宿舍"],
  ["鍵盤", "滑鼠", "螢幕", "喇叭", "耳機"],
  ["沙發", "茶几", "書櫃", "檯燈", "窗簾"],
  ["枕頭", "棉被", "床單", "拖鞋", "浴巾"],
  ["冰箱", "微波", "烤箱", "水壺", "碗盤"],
];

/** Hint words: never in an envelope, so a hint can never coincide with a hidden word. */
export const HINT_WORDS: readonly string[] = [
  "醫生",
  "醫院",
  "護士",
  "藥師",
  "病房",
  "診所",
  "手術",
  "急診",
  "藥局",
  "掛號",
  "病歷",
  "處方",
  "點滴",
  "胃鏡",
  "聽診",
  "護理",
  "救護",
  "麻醉",
  "復健",
  "保健",
];

/** Wrong answers used by the scripts; disjoint from envelopes and hints. */
export const WRONG_GUESS = "湯匙";
export const WRONG_GUESS_2 = "叉子";

export function defaultEnvelopes(
  ids: readonly string[],
  rounds: number,
): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  ids.forEach((id, index) => {
    const first = ROUND1[index] ?? ROUND1[0]!;
    const second = ROUND2[index] ?? ROUND2[0]!;
    out[id] = Array.from({ length: rounds }, (_, round) =>
      [...(round === 0 ? first : second)],
    );
  });
  return out;
}

export interface HarnessOptions {
  ready?: boolean;
  start?: boolean;
  envelopes?: Record<string, string[][]>;
}

/**
 * Scripted-game harness: every `reduce` result is recorded so view tests can
 * inspect every intermediate state.
 */
export class Harness {
  state: GameState;
  now = T0;
  snapshots: GameState[] = [];

  constructor(mode: GameMode = "quick", count = 2, options: HarnessOptions = {}) {
    const ids = Array.from({ length: count }, (_, index) => `p${index + 1}`);
    this.state = createGame("ABC234", mode, { id: ids[0]!, name: "玩家1" }, this.now);
    this.snapshots.push(this.state);
    for (let index = 1; index < ids.length; index += 1) {
      this.dispatch({ type: "JOIN", playerId: ids[index]!, name: `玩家${index + 1}` });
    }
    if (options.ready ?? true) {
      for (const id of ids) {
        this.dispatch({ type: "SET_READY", playerId: id, ready: true });
      }
    }
    if (options.start) {
      this.dispatch({
        type: "START",
        by: ids[0]!,
        envelopes: options.envelopes ?? defaultEnvelopes(ids, MODE_PRESETS[mode].rounds),
      });
    }
  }

  get playerIds(): string[] {
    return this.state.players.map((p) => p.id);
  }

  advance(ms: number): void {
    this.now += ms;
  }

  /** Dispatch and fail loudly on an error result. */
  dispatch(event: GameEvent, at?: number): ReduceResult {
    if (at !== undefined) this.now = at;
    const result = reduce(this.state, event, this.now);
    if (result.error) throw new Error(`unexpected ${result.error} for ${event.type}`);
    this.state = result.state;
    this.snapshots.push(result.state);
    return result;
  }

  /** Dispatch and keep the error result (state stays untouched on error). */
  attempt(event: GameEvent, at?: number): ReduceResult {
    if (at !== undefined) this.now = at;
    const result = reduce(this.state, event, this.now);
    if (!result.error) {
      this.state = result.state;
      this.snapshots.push(result.state);
    }
    return result;
  }

  /** Fire the current phase's timeout at its deadline. */
  timeout(rand = 0.5, at?: number): ReduceResult {
    const when = at ?? this.state.deadline ?? this.now;
    return this.dispatch({ type: "TIMEOUT", phaseSeq: this.state.phaseSeq, rand }, when);
  }

  player(id: PlayerId): Player {
    const found = this.state.players.find((p) => p.id === id);
    if (!found) throw new Error(`no player ${id}`);
    return found;
  }

  score(id: PlayerId): number {
    return this.player(id).score;
  }

  hidden(id: PlayerId): string | null {
    return this.player(id).hiddenWord;
  }

  view(id: PlayerId): PlayerView {
    return viewFor(this.state, id);
  }
}

export function setterOf(h: Harness): PlayerId {
  const turn = h.state.turn;
  if (!turn) throw new Error("no active turn");
  return turn.setterId;
}

export function stageOf(h: Harness): Stage {
  const turn = h.state.turn;
  if (!turn || turn.stages.length === 0) throw new Error("no active stage");
  return turn.stages[turn.stages.length - 1]!;
}

export function lastHint(h: Harness): Hint {
  const hints = stageOf(h).hints;
  const hint = hints[hints.length - 1];
  if (!hint) throw new Error("no hint");
  return hint;
}

/** Every player picks the first word of their envelope. */
export function pickAll(h: Harness): void {
  for (const player of [...h.state.players]) {
    if (h.state.phase !== "pick") break;
    h.dispatch({ type: "PICK_WORD", playerId: player.id, word: player.envelope[0]! });
  }
}

/** Setter submits `word`; returns the recorded hint (pending or rejected). */
export function submitHint(h: Harness, word: string): Hint {
  h.dispatch({ type: "SUBMIT_HINT", playerId: setterOf(h), word });
  return lastHint(h);
}

export function scoreHint(h: Harness, hintId: string, score: number, isNoun = true): void {
  h.dispatch({ type: "HINT_SCORED", hintId, score, isNoun });
}

/** Every active guesser submits one answer. */
export function guessAll(h: Harness, correct: boolean, wrongWord = WRONG_GUESS): void {
  const turn = h.state.turn;
  if (!turn) throw new Error("no active turn");
  const hidden = h.hidden(turn.setterId) ?? "";
  for (const player of [...h.state.players]) {
    if (h.state.phase !== "guess") break;
    if (player.id === turn.setterId || player.away) continue;
    h.dispatch({
      type: "SUBMIT_GUESS",
      playerId: player.id,
      words: [correct ? hidden : wrongWord],
    });
  }
}

/** Submit + score one hint, then stop the hint phase so it is revealed. */
export function submitReveal(h: Harness, word: string, score: number): Hint {
  const setter = setterOf(h);
  const hint = submitHint(h, word);
  scoreHint(h, hint.id, score);
  if (h.state.phase === "hint") h.dispatch({ type: "STOP_HINTS", playerId: setter });
  return hint;
}

/**
 * One full stage: submit a hint, score it, stop the hint phase, guess (or let the
 * guess timer run), then consume the result timer.
 */
export function playStage(
  h: Harness,
  word: string,
  score: number,
  guess: "correct" | "wrong" | "none" = "wrong",
): void {
  submitReveal(h, word, score);
  if (h.state.phase === "guess") {
    if (guess === "none") h.timeout();
    else guessAll(h, guess === "correct");
  }
  if (h.state.phase === "result") h.timeout();
}

/** A stage with no scored hint: hint timer → result, then result timer → next. */
export function skipStage(h: Harness): void {
  if (h.state.phase === "hint") h.timeout();
  if (h.state.phase === "result") h.timeout();
}

/** Burn the rest of the current turn without scoring anything or guessing. */
export function finishTurnWithoutHints(h: Harness): void {
  let guard = 0;
  while (h.state.turn && h.state.turn.outcome === null && h.state.phase !== "final") {
    guard += 1;
    if (guard > 20) throw new Error("finishTurnWithoutHints did not converge");
    if (h.state.phase === "hint") h.timeout();
    else if (h.state.phase === "result") h.timeout();
    else throw new Error(`unexpected phase ${h.state.phase}`);
  }
  if (h.state.phase === "result") h.timeout();
}

