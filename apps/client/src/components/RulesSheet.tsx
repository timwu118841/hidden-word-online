import { useState } from "react";
import type { RuleConfig } from "@hw/core";
import { UI } from "../i18n/zh-TW";

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

export function RulesSheet({ rules }: { rules: RuleConfig }) {
  const [open, setOpen] = useState(false);

  const items = [
    UI.rules.players(rules.minPlayers, rules.maxPlayers),
    UI.rules.rounds(rules.rounds, rules.roundMultiplier.slice(0, rules.rounds)),
    UI.rules.envelope(rules.envelopeSize),
    UI.rules.turns,
    UI.rules.stages(rules.stagesPerTurn),
    UI.rules.hints(rules.maxHintsPerStage),
    UI.rules.instant(rules.instantRevealThreshold),
    UI.rules.reveal,
    UI.rules.guess,
    UI.rules.correct(rules.guesserPoints),
    UI.rules.setterPoints([...rules.setterStagePoints], rules.minRevealScoreForSetter),
    UI.rules.noReveal,
    UI.rules.pieces(rules.startingPieces),
    UI.rules.wordLength(rules.maxWordLength),
    UI.rules.timers(
      seconds(rules.timers.pickMs),
      seconds(rules.timers.hintMs),
      seconds(rules.timers.guessMs),
      seconds(rules.timers.resultMs),
    ),
    UI.rules.disconnect(seconds(rules.disconnectGraceMs)),
    UI.rules.ranking,
  ];

  return (
    <>
      <button type="button" className="btn btn-ghost rules-button" onClick={() => setOpen(true)}>
        {UI.common.rules}
      </button>
      {open ? (
        <div className="sheet-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={UI.rules.title}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sheet-header">
              <h2>{UI.rules.heading}</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                {UI.common.close}
              </button>
            </header>
            <ul className="rules-list">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
