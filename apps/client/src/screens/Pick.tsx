import { useState } from "react";
import type { PlayerView } from "@hw/core";
import { UI } from "../i18n/zh-TW";
import { Timer } from "../components/Timer";
import { store, useStore } from "../store";

export function Pick({ view }: { view: PlayerView }) {
  const { clockOffset } = useStore();
  const [sending, setSending] = useState(false);
  const picked = view.me.hiddenWord;
  const waiting = view.players.filter((player) => !player.hasPicked).length;

  const pick = async (word: string) => {
    if (sending) return;
    setSending(true);
    await store.sendIntent({ t: "pick", word });
    setSending(false);
  };

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>{UI.pick.title}</h1>
          <p className="muted">{UI.turn.round(view.round + 1, view.totalRounds)}</p>
        </div>
        <Timer deadline={view.deadline} clockOffset={clockOffset} />
      </header>

      <p className="muted">{UI.pick.subtitle}</p>

      {picked !== null ? (
        <div className="picked-panel">
          <span className="field-label">{UI.pick.picked}</span>
          <strong className="picked-word" data-testid="picked-word">
            {picked}
          </strong>
          <p className="muted">{waiting > 0 ? UI.pick.waiting(waiting) : UI.pick.allPicked}</p>
        </div>
      ) : (
        <>
          <h2 className="section-title">{UI.pick.envelope}</h2>
          <div className="envelope-grid">
            {view.me.envelope.map((word) => (
              <button
                key={word}
                type="button"
                className="btn envelope-word"
                data-testid="envelope-word"
                data-word={word}
                disabled={sending}
                onClick={() => void pick(word)}
              >
                {word}
              </button>
            ))}
          </div>
          <p className="muted">{UI.pick.timeoutHint}</p>
        </>
      )}
    </section>
  );
}
