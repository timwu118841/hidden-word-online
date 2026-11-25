import { expect, type Page } from "@playwright/test";
import { Converter } from "opencc-js/t2cn";

export interface PlayerHandle {
  name: string;
  page: Page;
}

export type UiPhase = "lobby" | "pick" | "hint" | "guess" | "result" | "final" | "loading";

interface TurnState {
  setterPage: Page;
  turnNo: number;
  hiddenWord: string;
  usedHints: Set<string>;
}

/** Two-character nouns that never trip the fake scorer's ≥95 instant reveal. */
const HINT_CANDIDATES = [
  "東西",
  "地方",
  "問題",
  "朋友",
  "工作",
  "生活",
  "世界",
  "故事",
  "心情",
  "聲音",
  "風景",
  "顏色",
  "動物",
  "水果",
  "音樂",
  "運動",
  "天氣",
  "房子",
  "衣服",
  "食物",
  "工具",
  "畫面",
  "數字",
  "口味",
] as const;

let converter: ((text: string) => string) | null = null;

/** Traditional → Simplified, so the answer goes through the server's cn2t normalizer. */
export function toSimplified(word: string): string {
  if (converter === null) converter = Converter({ from: "tw", to: "cn" });
  const simplified = converter(word);
  return simplified === word ? word : simplified;
}

async function isVisible(page: Page, testId: string): Promise<boolean> {
  return page.getByTestId(testId).first().isVisible();
}

async function firstWith(players: PlayerHandle[], testId: string): Promise<Page | null> {
  for (const player of players) {
    if (await isVisible(player.page, testId)) return player.page;
  }
  return null;
}

/**
 * Best-effort snapshot of the UI phase. `result` is only reliable while the
 * short result timer is running, so callers poll instead of reading it once.
 */
export async function currentPhase(players: PlayerHandle[]): Promise<UiPhase> {
  if (await firstWith(players, "final-ranking")) return "final";
  if (await firstWith(players, "envelope-word")) return "pick";
  if (await firstWith(players, "hint-input")) return "hint";
  if (await firstWith(players, "guess-input")) return "guess";
  if (await firstWith(players, "stage-result")) return "result";
  if (await firstWith(players, "ready-toggle")) return "lobby";
  return "loading";
}

async function waitForPhaseToChange(players: PlayerHandle[], phase: UiPhase): Promise<void> {
  await expect.poll(() => currentPhase(players), { timeout: 20_000 }).not.toBe(phase);
}

export async function createQuickRoom(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("mode-quick").click();
  await page.getByTestId("create-room").click();

  const roomCode = page.getByTestId("room-code");
  await expect(roomCode).toBeVisible();
  const code = (await roomCode.innerText()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  return code;
}

export async function joinRoom(page: Page, roomCode: string, name: string): Promise<void> {
  await page.goto(`/r/${roomCode}`);
  await page.getByTestId("join-name-input").fill(name);
  await page.getByTestId("join-room").click();
  await expect(page.getByTestId("room-code")).toHaveText(roomCode);
}

/** Every player readies up, the host starts, then everyone picks the first envelope word. */
export async function startAndPick(players: PlayerHandle[]): Promise<void> {
  const host = players[0];
  if (host === undefined) throw new Error("至少需要一位玩家");

  for (const player of players) {
    await expect(player.page.getByTestId("ready-toggle")).toBeVisible();
    await player.page.getByTestId("ready-toggle").click();
  }
  await expect(host.page.getByTestId("start-game")).toBeEnabled();
  await host.page.getByTestId("start-game").click();

  for (const player of players) {
    const firstWord = player.page.getByTestId("envelope-word").first();
    await expect(firstWord).toBeVisible();
    await firstWord.click();
  }
  // The last pick advances straight to the first turn, so there is no
  // intermediate "picked" view to assert on every page.
  await expect.poll(() => currentPhase(players), { timeout: 20_000 }).toBe("hint");
}

async function pickAvailableEnvelopes(players: PlayerHandle[]): Promise<void> {
  for (const player of players) {
    const firstWord = player.page.getByTestId("envelope-word").first();
    if (await firstWord.isVisible()) await firstWord.click();
  }
}

function chooseHint(hiddenWord: string, usedHints: Set<string>): string {
  for (const candidate of HINT_CANDIDATES) {
    if (usedHints.has(candidate)) continue;
    if (candidate === hiddenWord) continue;
    if (hiddenWord.includes(candidate) || candidate.includes(hiddenWord)) continue;
    return candidate;
  }
  throw new Error(`找不到可用的提示詞（隱藏詞：${hiddenWord}）`);
}

async function playHintStage(players: PlayerHandle[], turn: TurnState): Promise<void> {
  const setterPage = turn.setterPage;
  const hiddenWord = (await setterPage.getByTestId("my-hidden-word").innerText()).trim();
  if (hiddenWord.length === 0 || hiddenWord === "—") {
    throw new Error("無法讀取出題者的隱藏詞");
  }
  turn.hiddenWord = hiddenWord;

  // A deliberately invalid hint is rejected immediately and must not consume a slot.
  const rejectedCards = setterPage.locator('[data-testid="hint-card"][data-status="rejected"]');
  const rejectedBefore = await rejectedCards.count();
  await setterPage.getByTestId("hint-input").fill("abc");
  await setterPage.getByTestId("hint-submit").click();
  await expect.poll(() => rejectedCards.count(), { timeout: 10_000 }).toBe(rejectedBefore + 1);

  const hint = chooseHint(hiddenWord, turn.usedHints);
  turn.usedHints.add(hint);
  await setterPage.getByTestId("hint-input").fill(hint);
  await setterPage.getByTestId("hint-submit").click();

  const scoredCard = setterPage.getByTestId("hint-card").filter({ hasText: hint }).last();
  await expect(scoredCard).toHaveAttribute("data-status", "scored", { timeout: 10_000 });

  // While the guessers are still in the hint phase, their visible page must not
  // contain the hidden word or the (not yet revealed) hint word.
  const guesserPages = players.map((player) => player.page).filter((page) => page !== setterPage);
  const scoredCount = await setterPage
    .locator('[data-testid="hint-card"][data-status="scored"]')
    .count();
  for (const guesserPage of guesserPages) {
    await expect(guesserPage.getByTestId("phase-title")).toHaveAttribute("data-phase", "hint");
    await expect
      .poll(
        () => guesserPage.locator('[data-testid="hint-card"][data-status="scored"]').count(),
        { timeout: 10_000 },
      )
      .toBe(scoredCount);
    const visibleGame = await guesserPage.locator("main").innerText();
    expect(visibleGame).not.toContain(hiddenWord);
    expect(visibleGame).not.toContain(hint);
  }

  await setterPage.getByTestId("stop-hints").click();
  // Every view must leave the hint phase, including the setter's own: until its
  // view updates, the driver would see a stale hint form and re-enter this stage.
  await expect(setterPage.getByTestId("hint-input")).toBeHidden({ timeout: 15_000 });
  for (const guesserPage of guesserPages) {
    await expect(guesserPage.getByTestId("guess-input")).toBeVisible({ timeout: 15_000 });
  }
}

async function playGuessStage(players: PlayerHandle[], turn: TurnState): Promise<void> {
  const guesserPages = players.map((player) => player.page).filter((page) => page !== turn.setterPage);
  for (const guesserPage of guesserPages) {
    await expect(guesserPage.getByTestId("guess-input")).toBeVisible({ timeout: 15_000 });
  }

  if (turn.turnNo === 1) {
    // The first setter's hidden word is answered correctly (possibly Simplified)
    // by one guesser; the rest pass.
    const [target, ...others] = guesserPages;
    if (target === undefined) throw new Error("找不到猜題者");
    await target.getByTestId("guess-input").fill(toSimplified(turn.hiddenWord));
    await target.getByTestId("guess-submit").click();
    for (const other of others) {
      await other.getByTestId("guess-pass").click();
    }
  } else {
    // Later turns only pass, so the setter walks through all three stages.
    for (const guesserPage of guesserPages) {
      await guesserPage.getByTestId("guess-pass").click();
    }
  }

  await waitForPhaseToChange(players, "guess");
}

/**
 * Drives the UI through a complete quick game: pick → hint/guess/result for every
 * stage until every page shows the final ranking.
 */
export async function playQuickGameToFinal(players: PlayerHandle[]): Promise<void> {
  let turnNo = 0;
  let currentTurn: TurnState | null = null;

  for (let step = 0; step < 400; step += 1) {
    const phase = await currentPhase(players);
    switch (phase) {
      case "final":
        return;
      case "pick":
        await pickAvailableEnvelopes(players);
        break;
      case "hint": {
        const setterPage = await firstWith(players, "hint-input");
        if (setterPage === null) {
          await waitForPhaseToChange(players, "hint");
          break;
        }
        if (currentTurn === null || currentTurn.setterPage !== setterPage) {
          turnNo += 1;
          currentTurn = { setterPage, turnNo, hiddenWord: "", usedHints: new Set() };
        }
        await playHintStage(players, currentTurn);
        break;
      }
      case "guess":
        if (currentTurn === null) throw new Error("猜測階段前沒有觀察到出題階段");
        await playGuessStage(players, currentTurn);
        break;
      case "result":
      case "loading":
        await waitForPhaseToChange(players, phase);
        break;
      case "lobby":
        throw new Error("遊戲尚未開始，仍停留在等待大廳");
    }
  }

  throw new Error("遊戲在預期步數內未結束");
}

export interface RankingRow {
  playerId: string;
  rank: number;
  score: number;
}

export async function readRanking(page: Page): Promise<RankingRow[]> {
  return page.getByTestId("ranking-row").evaluateAll((elements) =>
    elements.map((element) => {
      const numbers = (element.textContent ?? "").match(/\d+/g) ?? [];
      return {
        playerId: element.getAttribute("data-player-id") ?? "",
        rank: Number(element.getAttribute("data-rank")),
        score: Number(numbers[numbers.length - 1] ?? Number.NaN),
      };
    }),
  );
}

/** Asserts competition ranking (ties share a rank) for a finished game. */
export function assertRankingConsistent(rows: RankingRow[], playerCount: number): void {
  expect(rows).toHaveLength(playerCount);
  expect(new Set(rows.map((row) => row.playerId)).size).toBe(playerCount);
  for (const row of rows) {
    const expectedRank = 1 + rows.filter((other) => other.score > row.score).length;
    expect(row.rank).toBe(expectedRank);
  }
}
