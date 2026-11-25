import { once } from "node:events";
import { io as createSocket, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ClientToServerEvents,
  CreateRoomBody,
  ErrorCode,
  Intent,
  IntentAck,
  JoinRoomBody,
  PlayerView,
  ServerToClientEvents,
  SessionInfo,
  SocketAuth,
} from "@hw/core";
import { createApp, type CreatedApp } from "../src/app";
import type { RulesOverride } from "../src/rooms/RoomManager";
import { FakeScorer, fakePairKey } from "../src/scoring/FakeScorer";
import type { ScoreResult } from "../src/scoring/Scorer";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type FatalPayload = { code: ErrorCode | "kicked" };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

// Node 24 provides Promise.withResolvers; the repo's ES2023 lib types do not.
const promiseWithResolvers = Promise as unknown as {
  withResolvers<U>(): Deferred<U>;
};

function deferred<T>(): Deferred<T> {
  return promiseWithResolvers.withResolvers<T>();
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Every envelope word is two Han characters and unique, so substring checks are exact. */
const WORDS = [
  "醫院",
  "學校",
  "汽車",
  "冰箱",
  "蘋果",
  "香蕉",
  "鋼琴",
  "雨傘",
  "月亮",
  "老虎",
  "足球",
  "咖啡",
  "公園",
  "電腦",
  "手機",
  "眼鏡",
  "帽子",
  "椅子",
  "桌子",
  "書本",
] as const;

/** Hint words are outside every envelope and contain no envelope word as a substring. */
const TURN0_HINTS = ["醫師", "護士"] as const;
const TURN1_HINTS = ["黑板", "雨滴", "燈塔"] as const;
const TURN2_HINTS = ["書架"] as const;
const REJECTED_HINT = "hello";
const ALL_HINT_WORDS = [REJECTED_HINT, ...TURN0_HINTS, ...TURN1_HINTS, ...TURN2_HINTS];

/** Deliberately not in any envelope, so a wrong guess never surfaces someone's envelope word. */
const WRONG_GUESS = "湯匙";

const TEST_RULES: RulesOverride = {
  timers: { pickMs: 3000, hintMs: 3000, guessMs: 3000, resultMs: 200 },
  disconnectGraceMs: 400,
};

interface TestApp {
  app: CreatedApp;
  table: Record<string, ScoreResult>;
  baseUrl: string;
  close(): Promise<void>;
}

async function startTestApp(options: { table?: Record<string, ScoreResult> } = {}): Promise<TestApp> {
  const table = options.table ?? {};
  const app = createApp({
    scorer: new FakeScorer(table),
    words: WORDS,
    rulesOverride: TEST_RULES,
  });

  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const address = app.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("無法取得測試埠");
  }

  return {
    app,
    table,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => app.close(),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

async function httpCreate(
  baseUrl: string,
  name: string,
  mode: "quick" | "full" = "quick",
): Promise<SessionInfo> {
  const body: CreateRoomBody = { name, mode };
  const response = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as SessionInfo;
}

async function httpJoinRequest(
  baseUrl: string,
  roomCode: string,
  name: string,
): Promise<Response> {
  const body: JoinRoomBody = { name };
  return fetch(`${baseUrl}/api/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function httpJoin(baseUrl: string, roomCode: string, name: string): Promise<SessionInfo> {
  const response = await httpJoinRequest(baseUrl, roomCode, name);
  expect(response.status).toBe(200);
  return (await response.json()) as SessionInfo;
}

/* ------------------------------------------------------------------ */
/* Socket helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Real platform timers are intentional here: server phase timers, the grace
 * period and Socket.IO delivery all run on the real clock, so fake timers would
 * test a different system. Every wait resolves on an observed event; timeouts
 * are failure guards, not sleeps.
 */
class TestClient {
  readonly socket: TestSocket;
  readonly views: PlayerView[] = [];
  readonly fatals: FatalPayload[] = [];

  private cursor = 0;
  private readonly waiters = new Set<(view: PlayerView) => boolean>();

  constructor(
    baseUrl: string,
    readonly session: SessionInfo,
  ) {
    const auth: SocketAuth = {
      roomCode: session.roomCode,
      sessionToken: session.sessionToken,
    };
    this.socket = createSocket(baseUrl, {
      auth,
      forceNew: true,
      transports: ["websocket"],
      reconnection: false,
    }) as unknown as TestSocket;

    this.socket.on("view", (view) => {
      this.views.push(view);
      for (const waiter of [...this.waiters]) {
        if (waiter(view)) this.waiters.delete(waiter);
      }
    });
    this.socket.on("fatal", (payload) => {
      this.fatals.push(payload);
    });
  }

  connect(): Promise<PlayerView> {
    return this.waitFor(() => true, "第一次 view");
  }

  /** Waits for the next unconsumed view matching `predicate`. */
  waitFor(
    predicate: (view: PlayerView) => boolean,
    label: string,
    timeoutMs = 5000,
  ): Promise<PlayerView> {
    for (let index = this.cursor; index < this.views.length; index += 1) {
      const view = this.views[index];
      if (view !== undefined && predicate(view)) {
        this.cursor = index + 1;
        return Promise.resolve(view);
      }
    }
    this.cursor = this.views.length;

    const { promise, resolve, reject } = deferred<PlayerView>();
    const timer = setTimeout(() => {
      this.waiters.delete(waiter);
      reject(new Error(`等待逾時：${label}`));
    }, timeoutMs);
    const waiter = (view: PlayerView): boolean => {
      if (!predicate(view)) return false;
      clearTimeout(timer);
      resolve(view);
      return true;
    };
    this.waiters.add(waiter);
    return promise;
  }

  intent(intent: Intent): Promise<IntentAck> {
    const { promise, resolve, reject } = deferred<IntentAck>();
    const timer = setTimeout(() => reject(new Error("等待 intent ack 逾時")), 5000);
    this.socket.emit("intent", intent, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    return promise;
  }

  waitForDisconnect(timeoutMs = 3000): Promise<void> {
    if (!this.socket.connected) return Promise.resolve();
    const { promise, resolve, reject } = deferred<void>();
    const timer = setTimeout(() => reject(new Error("等待斷線逾時")), timeoutMs);
    this.socket.once("disconnect", () => {
      clearTimeout(timer);
      resolve();
    });
    return promise;
  }

  close(): void {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}

async function sendOk(client: TestClient, intent: Intent): Promise<void> {
  const result = await client.intent(intent);
  expect(result).toEqual({ ok: true });
}

function openSocketRaw(baseUrl: string, auth: unknown): TestSocket {
  return createSocket(baseUrl, {
    auth: auth as Record<string, unknown>,
    forceNew: true,
    transports: ["websocket"],
    reconnection: false,
  }) as unknown as TestSocket;
}

function nextFatal(socket: TestSocket, timeoutMs = 3000): Promise<FatalPayload> {
  const { promise, resolve, reject } = deferred<FatalPayload>();
  const timer = setTimeout(() => reject(new Error("等待 fatal 逾時")), timeoutMs);
  socket.once("fatal", (payload) => {
    clearTimeout(timer);
    resolve(payload);
  });
  return promise;
}

/* ------------------------------------------------------------------ */
/* View inspection helpers                                             */
/* ------------------------------------------------------------------ */

function lastStage(view: PlayerView) {
  return view.turn?.stages.at(-1);
}

function hintByWord(view: PlayerView, word: string) {
  for (const stage of view.turn?.stages ?? []) {
    const hint = stage.hints.find((entry) => entry.word === word);
    if (hint !== undefined) return hint;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Scripted full game                                                  */
/* ------------------------------------------------------------------ */

interface GameHarness {
  app: TestApp;
  clients: TestClient[];
  sessions: SessionInfo[];
  envelopes: Record<string, string[]>;
  hidden: Record<string, string>;
  finalView: PlayerView;
}

async function runQuickGame(): Promise<GameHarness> {
  const app = await startTestApp();
  const clients: TestClient[] = [];

  try {
    const hostSession = await httpCreate(app.baseUrl, "主機");
    const secondSession = await httpJoin(app.baseUrl, hostSession.roomCode, "玩家乙");
    const thirdSession = await httpJoin(app.baseUrl, hostSession.roomCode, "玩家丙");
    const sessions = [hostSession, secondSession, thirdSession];

    for (const session of sessions) clients.push(new TestClient(app.baseUrl, session));
    await Promise.all(clients.map((client) => client.connect()));

    for (const client of clients) await sendOk(client, { t: "ready", ready: true });
    await sendOk(clients[0]!, { t: "start" });

    const envelopes: Record<string, string[]> = {};
    const hidden: Record<string, string> = {};

    for (const client of clients) {
      const view = await client.waitFor((candidate) => candidate.phase === "pick", "等待選詞");
      const word = view.me.envelope[0];
      if (word === undefined) throw new Error("信封沒有單詞");
      await sendOk(client, { t: "pick", word });
    }
    for (const client of clients) {
      const view = await client.waitFor(
        (candidate) => candidate.me.hiddenWord !== null,
        "等待隱藏詞",
      );
      envelopes[view.me.id] = [...view.me.envelope];
      hidden[view.me.id] = view.me.hiddenWord as string;
    }

    const host = clients[0]!;
    const second = clients[1]!;
    const third = clients[2]!;
    const hostId = hostSession.playerId;
    const secondId = secondSession.playerId;
    const thirdId = thirdSession.playerId;
    const hostHidden = hidden[hostId]!;
    const secondHidden = hidden[secondId]!;
    const thirdHidden = hidden[thirdId]!;

    /* ---------------- turn 0: host sets, one correct guess ---------------- */

    await Promise.all(
      clients.map((client) =>
        client.waitFor(
          (view) => view.phase === "hint" && view.turn?.setterId === hostId,
          "等待第一位出題者",
        ),
      ),
    );

    await sendOk(host, { t: "hint", word: REJECTED_HINT });
    await host.waitFor(
      (view) => hintByWord(view, REJECTED_HINT)?.status === "rejected",
      "等待格式錯誤的提示",
    );

    for (const [hint, score] of [
      [TURN0_HINTS[0], 75],
      [TURN0_HINTS[1], 60],
    ] as const) {
      app.table[fakePairKey(hostHidden, hint)] = { score, isNoun: true };
      await sendOk(host, { t: "hint", word: hint });
      await host.waitFor(
        (view) => hintByWord(view, hint)?.status === "scored",
        `等待提示 ${hint} 評分`,
      );
    }

    await sendOk(host, { t: "stopHints" });
    await host.waitFor(
      (view) =>
        view.phase === "guess" && lastStage(view)?.revealed?.word === TURN0_HINTS[0],
      "等待第一階段揭露",
    );
    await sendOk(second, { t: "guess", words: [hostHidden] });
    await sendOk(third, { t: "guess", words: [WRONG_GUESS] });
    await host.waitFor(
      (view) => view.phase === "result" && view.turn?.outcome === "guessed",
      "等待第一回合結果",
    );

    /* ---------------- turn 1: second sets, nobody guesses right ---------------- */

    await second.waitFor(
      (view) =>
        view.phase === "hint" && view.turn?.setterId === secondId && view.turnIndex === 1,
      "等待第二位出題者",
    );

    const secondTurnHints = [
      [TURN1_HINTS[0], 80],
      [TURN1_HINTS[1], 40],
      [TURN1_HINTS[2], 70],
    ] as const;

    for (const [stageIndex, [hint, score]] of secondTurnHints.entries()) {
      if (stageIndex > 0) {
        await second.waitFor(
          (view) => view.phase === "hint" && view.turn?.stages.length === stageIndex + 1,
          `等待第二回合第 ${stageIndex + 1} 階段`,
        );
      }
      app.table[fakePairKey(secondHidden, hint)] = { score, isNoun: true };
      await sendOk(second, { t: "hint", word: hint });
      await second.waitFor(
        (view) => hintByWord(view, hint)?.status === "scored",
        `等待提示 ${hint} 評分`,
      );
      await sendOk(second, { t: "stopHints" });
      await second.waitFor(
        (view) => view.phase === "guess" && lastStage(view)?.revealed?.word === hint,
        `等待揭露 ${hint}`,
      );
      await sendOk(host, { t: "guess", words: [WRONG_GUESS] });
      await sendOk(third, { t: "guess", words: [WRONG_GUESS] });
    }

    await second.waitFor(
      (view) => view.turn?.outcome === "exhausted",
      "等待第二回合以耗盡作收",
    );

    /* ---------------- turn 2: third sets, one correct guess → final ---------------- */

    await third.waitFor(
      (view) =>
        view.phase === "hint" && view.turn?.setterId === thirdId && view.turnIndex === 2,
      "等待第三位出題者",
    );

    app.table[fakePairKey(thirdHidden, TURN2_HINTS[0])] = { score: 90, isNoun: true };
    await sendOk(third, { t: "hint", word: TURN2_HINTS[0] });
    await third.waitFor(
      (view) => hintByWord(view, TURN2_HINTS[0])?.status === "scored",
      "等待第三回合提示評分",
    );
    await sendOk(third, { t: "stopHints" });
    await third.waitFor(
      (view) => view.phase === "guess" && lastStage(view)?.revealed?.word === TURN2_HINTS[0],
      "等待第三回合揭露",
    );
    await sendOk(host, { t: "guess", words: [thirdHidden] });
    await sendOk(second, { t: "guess", words: [WRONG_GUESS] });

    const finalView = await host.waitFor((view) => view.phase === "final", "等待終局", 5000);

    return { app, clients, sessions, envelopes, hidden, finalView };
  } catch (error) {
    for (const client of clients) client.close();
    await app.close();
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Leak check                                                          */
/* ------------------------------------------------------------------ */

function revealedHintWords(view: PlayerView): Set<string> {
  const allowed = new Set<string>();
  for (const stage of view.turn?.stages ?? []) {
    if (stage.revealed !== null) allowed.add(stage.revealed.word);
    if (view.turn?.setterId === view.me.id) {
      for (const hint of stage.hints) {
        if (hint.word !== null) allowed.add(hint.word);
      }
    }
  }
  for (const entry of view.history) {
    for (const reveal of entry.revealed) allowed.add(reveal.word);
  }
  return allowed;
}

function hiddenWordIsPublic(view: PlayerView, ownerId: string, word: string): boolean {
  if (view.phase === "final") return true;
  if (view.history.some((entry) => entry.setterId === ownerId && entry.hiddenWord === word)) {
    return true;
  }
  // A guesser necessarily sees their own submitted guess, even when it is correct.
  if (view.turn?.stages.some((stage) => stage.myGuess?.includes(word) === true)) return true;
  return (
    view.turn !== null &&
    view.turn.setterId === ownerId &&
    view.turn.outcome !== null
  );
}

function assertNoSecretsLeaked(harness: GameHarness): void {
  const tokens = harness.sessions.map((session) => session.sessionToken);
  const owners = Object.keys(harness.envelopes);

  for (const client of harness.clients) {
    for (const view of client.views) {
      const serialized = JSON.stringify(view);
      const me = view.me.id;
      const context = `玩家 ${me} 的 ${view.phase} frame`;

      for (const token of tokens) {
        expect(serialized.includes(token), `${context} 泄漏 session token`).toBe(false);
      }

      for (const ownerId of owners) {
        if (ownerId === me) continue;
        const hiddenWord = harness.hidden[ownerId];
        for (const word of harness.envelopes[ownerId] ?? []) {
          if (word === hiddenWord) continue; // covered by the hidden-word rule below
          expect(serialized.includes(word), `${context} 泄漏他人信封詞 ${word}`).toBe(false);
        }
        if (hiddenWord !== undefined && !hiddenWordIsPublic(view, ownerId, hiddenWord)) {
          expect(serialized.includes(hiddenWord), `${context} 泄漏他人隱藏詞 ${hiddenWord}`).toBe(
            false,
          );
        }
      }

      const allowedHints = revealedHintWords(view);
      for (const word of ALL_HINT_WORDS) {
        if (allowedHints.has(word)) continue;
        expect(serialized.includes(word), `${context} 泄漏未揭露提示 ${word}`).toBe(false);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("integration: quick game", () => {
  let harness: GameHarness;

  beforeAll(async () => {
    harness = await runQuickGame();
  }, 30_000);

  afterAll(async () => {
    for (const client of harness.clients) client.close();
    await harness.app.close();
  });

  it("plays to final with the expected scores, ranking and history", () => {
    const [hostSession, secondSession, thirdSession] = harness.sessions;
    const hostId = hostSession!.playerId;
    const secondId = secondSession!.playerId;
    const thirdId = thirdSession!.playerId;

    const final = harness.finalView.final;
    expect(final).not.toBeNull();

    expect(final!.ranking.map((entry) => entry.playerId)).toEqual([secondId, hostId, thirdId]);
    expect(final!.ranking.map((entry) => entry.score)).toEqual([5, 1, 0]);
    expect(final!.ranking.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(final!.endReason).toBe("completed");
    expect(final!.hiddenWords).toEqual({
      [hostId]: harness.hidden[hostId],
      [secondId]: harness.hidden[secondId],
      [thirdId]: harness.hidden[thirdId],
    });

    expect(harness.finalView.history.map((entry) => entry.setterId)).toEqual([
      hostId,
      secondId,
      thirdId,
    ]);
    expect(harness.finalView.history.map((entry) => entry.outcome)).toEqual([
      "guessed",
      "exhausted",
      "guessed",
    ]);
    expect(harness.finalView.history.map((entry) => entry.setterPoints)).toEqual([0, 4, 0]);
    expect(harness.finalView.history[0]?.correctGuessers).toEqual([secondId]);
    expect(harness.finalView.history[2]?.correctGuessers).toEqual([hostId]);
  });

  it("never leaks hidden words, envelopes, hint words or tokens in any frame", () => {
    assertNoSecretsLeaked(harness);
  });
});

describe("integration: presence", () => {
  it("replaces the previous socket for the same player", async () => {
    const app = await startTestApp();
    const session = await httpCreate(app.baseUrl, "主機");
    const first = new TestClient(app.baseUrl, session);
    let second: TestClient | undefined;

    try {
      await first.connect();

      second = new TestClient(app.baseUrl, session);
      const view = await second.connect();
      expect(view.me.id).toBe(session.playerId);
      await first.waitForDisconnect(2000);

      await sendOk(second, { t: "ready", ready: true });
      const readyView = await second.waitFor(
        (candidate) =>
          candidate.players.some((player) => player.id === session.playerId && player.ready),
        "等待準備狀態",
      );
      expect(readyView.players.find((player) => player.id === session.playerId)?.ready).toBe(true);
    } finally {
      first.close();
      second?.close();
      await app.close();
    }
  });

  it("resumes a seat within the grace period and skips an away setter", async () => {
    const app = await startTestApp();
    const clients: TestClient[] = [];

    try {
      const hostSession = await httpCreate(app.baseUrl, "主機");
      const secondSession = await httpJoin(app.baseUrl, hostSession.roomCode, "玩家乙");
      const thirdSession = await httpJoin(app.baseUrl, hostSession.roomCode, "玩家丙");
      const sessions = [hostSession, secondSession, thirdSession];

      for (const session of sessions) clients.push(new TestClient(app.baseUrl, session));
      await Promise.all(clients.map((client) => client.connect()));

      for (const client of clients) await sendOk(client, { t: "ready", ready: true });
      await sendOk(clients[0]!, { t: "start" });

      const pickWords: Record<string, string> = {};
      const envelopes: Record<string, string[]> = {};
      for (const client of clients) {
        const view = await client.waitFor((candidate) => candidate.phase === "pick", "等待選詞");
        const word = view.me.envelope[0];
        if (word === undefined) throw new Error("信封沒有單詞");
        pickWords[view.me.id] = word;
        envelopes[view.me.id] = [...view.me.envelope];
      }

      const host = clients[0]!;
      const second = clients[1]!;
      const third = clients[2]!;
      const hostId = hostSession.playerId;
      const secondId = secondSession.playerId;
      const thirdId = thirdSession.playerId;

      /* reconnect within the grace period: same seat, same state */
      second.socket.disconnect();
      const reconnected = new TestClient(app.baseUrl, secondSession);
      clients.push(reconnected);
      const resumed = await reconnected.connect();

      expect(resumed.me.id).toBe(secondId);
      expect(resumed.phase).toBe("pick");
      expect(resumed.me.envelope).toEqual(envelopes[secondId]);
      expect(resumed.players.find((player) => player.id === secondId)).toMatchObject({
        connected: true,
        away: false,
        seat: 1,
      });

      await sendOk(host, { t: "pick", word: pickWords[hostId]! });
      await sendOk(reconnected, { t: "pick", word: pickWords[secondId]! });
      await sendOk(third, { t: "pick", word: pickWords[thirdId]! });

      const hostHiddenView = await host.waitFor(
        (view) => view.me.hiddenWord !== null,
        "等待隱藏詞",
      );
      const hostHidden = hostHiddenView.me.hiddenWord as string;

      /* disconnect past the grace period → away, and their setter turn is skipped */
      second.socket.disconnect();
      reconnected.socket.disconnect();
      await host.waitFor(
        (view) => view.players.some((player) => player.id === secondId && player.away),
        "等待玩家變為 away",
        3000,
      );

      app.table[fakePairKey(hostHidden, TURN1_HINTS[2])] = { score: 80, isNoun: true };
      await sendOk(host, { t: "hint", word: TURN1_HINTS[2] });
      await host.waitFor(
        (view) => hintByWord(view, TURN1_HINTS[2])?.status === "scored",
        "等待主持人提示評分",
      );
      await sendOk(host, { t: "stopHints" });
      await host.waitFor(
        (view) => view.phase === "guess" && lastStage(view)?.revealed?.word === TURN1_HINTS[2],
        "等待主持人階段揭露",
      );
      await sendOk(third, { t: "guess", words: [hostHidden] });
      await host.waitFor(
        (view) => view.phase === "result" && view.turn?.outcome === "guessed",
        "等待主持人回合結束",
      );

      const skipped = await host.waitFor(
        (view) =>
          view.phase === "hint" && view.turn?.setterId === thirdId && view.turnIndex === 2,
        "等待跳過 away 出題者",
        3000,
      );
      expect(skipped.history.map((entry) => entry.setterId)).toEqual([hostId]);
      expect(skipped.turn?.setterId).toBe(thirdId);
      expect(skipped.players.find((player) => player.id === secondId)?.away).toBe(true);
    } finally {
      for (const client of clients) client.close();
      await app.close();
    }
  });
});

describe("integration: HTTP and auth", () => {
  it("serves room info and rejects unknown, full and unauthenticated joins", async () => {
    const app = await startTestApp();

    try {
      const missing = await httpJoinRequest(app.baseUrl, "AAAAAA", "測試");
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "room_not_found" });

      const host = await httpCreate(app.baseUrl, "主機");
      for (let index = 0; index < 6; index += 1) {
        await httpJoin(app.baseUrl, host.roomCode, `玩家${index}`);
      }

      const full = await httpJoinRequest(app.baseUrl, host.roomCode, "多餘的人");
      expect(full.status).toBe(409);
      expect(await full.json()).toEqual({ error: "room_full" });

      const infoResponse = await fetch(`${app.baseUrl}/api/rooms/${host.roomCode}`);
      expect(infoResponse.status).toBe(200);
      expect(await infoResponse.json()).toMatchObject({
        roomCode: host.roomCode,
        mode: "quick",
        phase: "lobby",
        players: 7,
        maxPlayers: 7,
        joinable: false,
      });

      const missingInfo = await fetch(`${app.baseUrl}/api/rooms/AAAAAA`);
      expect(missingInfo.status).toBe(404);

      const unknownToken = openSocketRaw(app.baseUrl, {
        roomCode: host.roomCode,
        sessionToken: "f".repeat(32),
      });
      expect(await nextFatal(unknownToken)).toEqual({ code: "room_not_found" });
      unknownToken.disconnect();

      const malformedAuth = openSocketRaw(app.baseUrl, { roomCode: "bad", sessionToken: "x" });
      expect(await nextFatal(malformedAuth)).toEqual({ code: "room_not_found" });
      malformedAuth.disconnect();
    } finally {
      await app.close();
    }
  });
});

describe("integration: lobby kick", () => {
  it("notifies the kicked player and invalidates their session", async () => {
    const app = await startTestApp();
    const hostSession = await httpCreate(app.baseUrl, "主機");
    const targetSession = await httpJoin(app.baseUrl, hostSession.roomCode, "被踢的人");
    const host = new TestClient(app.baseUrl, hostSession);
    const target = new TestClient(app.baseUrl, targetSession);

    try {
      await Promise.all([host.connect(), target.connect()]);
      await host.waitFor((view) => view.players.length === 2, "等待第二位玩家");

      const fatal = nextFatal(target.socket);
      await sendOk(host, { t: "kick", target: targetSession.playerId });
      expect(await fatal).toEqual({ code: "kicked" });
      await target.waitForDisconnect();
      await host.waitFor((view) => view.players.length === 1, "等待被踢玩家消失");

      const stale = openSocketRaw(app.baseUrl, {
        roomCode: hostSession.roomCode,
        sessionToken: targetSession.sessionToken,
      });
      expect(await nextFatal(stale)).toEqual({ code: "room_not_found" });
      stale.disconnect();
    } finally {
      host.close();
      target.close();
      await app.close();
    }
  });
});
