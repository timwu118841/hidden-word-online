import { expect, test, type Browser } from "@playwright/test";
import {
  assertRankingConsistent,
  createQuickRoom,
  joinRoom,
  playQuickGameToFinal,
  readRanking,
  startAndPick,
  type PlayerHandle,
  type RankingRow,
} from "./helpers";

const PLAYER_NAMES = ["Alice", "Bob", "Carol"] as const;

/** Creates one browser context per player and joins them to a fresh quick room. */
async function setUpRoom(browser: Browser) {
  const contexts = await Promise.all(PLAYER_NAMES.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const players: PlayerHandle[] = PLAYER_NAMES.map((name, index) => ({
    name,
    page: pages[index]!,
  }));

  const host = players[0]!;
  const roomCode = await createQuickRoom(host.page, host.name);
  await Promise.all(players.slice(1).map((player) => joinRoom(player.page, roomCode, player.name)));

  return { contexts, players };
}

test("三位玩家完成一場快速對局，最終排名一致", async ({ browser }) => {
  const { contexts, players } = await setUpRoom(browser);
  try {
    await startAndPick(players);
    await playQuickGameToFinal(players);

    for (const player of players) {
      await expect(player.page.getByTestId("final-ranking")).toBeVisible({ timeout: 20_000 });
      await expect(player.page.getByTestId("ranking-row")).toHaveCount(PLAYER_NAMES.length);
    }

    const rankings = await Promise.all(players.map((player) => readRanking(player.page)));
    for (const ranking of rankings) {
      assertRankingConsistent(ranking, PLAYER_NAMES.length);
    }

    const normalized = (rows: RankingRow[]) =>
      [...rows].sort((a, b) => a.playerId.localeCompare(b.playerId));
    for (const ranking of rankings.slice(1)) {
      expect(normalized(ranking)).toEqual(normalized(rankings[0]!));
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("對局中重新載入頁面會回到原房間與原階段", async ({ browser }) => {
  const { contexts, players } = await setUpRoom(browser);
  try {
    await startAndPick(players);
    const guesser = players[1]!;
    await expect(guesser.page.getByTestId("phase-title")).toHaveAttribute("data-phase", "hint");

    await guesser.page.reload();

    // The stored session reconnects on its own; no join form, same seat and phase.
    await expect(guesser.page.getByTestId("join-room")).toBeHidden();
    await expect(guesser.page.getByTestId("player-strip")).toContainText(guesser.name, {
      timeout: 20_000,
    });
    await expect(guesser.page.getByTestId("phase-title")).toHaveAttribute("data-phase", "hint");
    await expect(guesser.page.getByTestId("reconnect-banner")).toBeHidden();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
