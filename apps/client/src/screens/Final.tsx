import type { PlayerView } from "@hw/core";
import { UI } from "../i18n/zh-TW";
import { store } from "../store";

export function Final({ view }: { view: PlayerView }) {
  const final = view.final;
  const nameOf = (playerId: string) => view.players.find((player) => player.id === playerId)?.name ?? "—";

  if (final === null) {
    return (
      <section className="screen">
        <p className="muted">{UI.common.loading}</p>
      </section>
    );
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>{UI.final.title}</h1>
          <p className="muted">
            {final.endReason === "completed" ? UI.final.endReasonCompleted : UI.final.endReasonNotEnoughPlayers}
          </p>
        </div>
      </header>

      <div className="table-wrap">
        <table className="ranking" data-testid="final-ranking">
          <thead>
            <tr>
              <th scope="col">{UI.final.ranking}</th>
              <th scope="col">{UI.final.player}</th>
              <th scope="col">{UI.final.score}</th>
            </tr>
          </thead>
          <tbody>
            {final.ranking.map((entry) => (
              <tr
                key={entry.playerId}
                data-testid="ranking-row"
                data-player-id={entry.playerId}
                data-rank={entry.rank}
                className={entry.playerId === view.me.id ? "ranking-me" : undefined}
              >
                <td className="ranking-rank">{entry.rank}</td>
                <td>
                  {nameOf(entry.playerId)}
                  {entry.playerId === view.me.id ? <span className="player-chip-you">（{UI.common.you}）</span> : null}
                </td>
                <td className="ranking-score">{entry.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">{UI.final.hiddenWords}</h2>
      <ul className="hidden-words">
        {view.players.map((player) => (
          <li className="hidden-word-row" key={player.id} data-player-id={player.id}>
            <span className="hidden-word-name">{player.name}</span>
            <strong className="hidden-word-value">{final.hiddenWords[player.id] ?? "—"}</strong>
          </li>
        ))}
        {view.players.length === 0 ? <li className="muted">{UI.final.noHiddenWords}</li> : null}
      </ul>

      <button type="button" className="btn btn-primary" data-testid="back-home" onClick={() => store.exitHome()}>
        {UI.final.backHome}
      </button>
    </section>
  );
}
