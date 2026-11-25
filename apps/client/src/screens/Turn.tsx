import { useEffect, useState, type FormEvent } from "react";
import type { PlayerView, StageView, TurnView } from "@hw/core";
import { UI } from "../i18n/zh-TW";
import { HintCard } from "../components/HintCard";
import { ScoreBand } from "../components/ScoreBand";
import { Timer } from "../components/Timer";
import { store, useStore } from "../store";

export function Turn({ view }: { view: PlayerView }) {
  const { clockOffset } = useStore();
  const turn = view.turn;
  const stage: StageView | null =
    turn !== null && turn.stages.length > 0 ? (turn.stages[turn.stages.length - 1] ?? null) : null;

  const [hintText, setHintText] = useState("");
  const [firstAnswer, setFirstAnswer] = useState("");
  const [secondAnswer, setSecondAnswer] = useState("");
  const [withPiece, setWithPiece] = useState(false);
  const [sendingHint, setSendingHint] = useState(false);
  const [sendingGuess, setSendingGuess] = useState(false);

  useEffect(() => {
    setFirstAnswer("");
    setSecondAnswer("");
    setWithPiece(false);
  }, [view.phase, turn?.round, stage?.index]);

  useEffect(() => {
    setHintText("");
  }, [turn?.setterId, stage?.index]);

  if (turn === null) {
    return (
      <section className="screen">
        <p className="muted">{UI.common.loading}</p>
      </section>
    );
  }

  const isSetter = turn.setterId === view.me.id;
  const setter = view.players.find((player) => player.id === turn.setterId);
  const mePlayer = view.players.find((player) => player.id === view.me.id);
  const stageNo = stage !== null ? stage.index + 1 : 1;
  const pending = stage !== null && stage.hints.some((hint) => hint.status === "pending");
  const usedHintSlots =
    stage !== null
      ? stage.hints.filter((hint) => hint.status === "pending" || hint.status === "scored").length
      : 0;
  const hintCapReached = usedHintSlots >= view.rules.maxHintsPerStage;
  const submitted = stage !== null && stage.myGuess !== null;
  const guesserTotal = view.players.filter((player) => player.id !== turn.setterId && !player.away).length;
  const canUsePiece = view.me.pieces > 0 && !turn.usedPieceThisTurn;
  const phaseTitle =
    view.phase === "hint" ? UI.turn.hintTitle : view.phase === "guess" ? UI.turn.guessTitle : UI.turn.resultTitle;

  const submitHint = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingHint) return;
    const word = hintText.trim();
    if (word.length === 0) return;
    setSendingHint(true);
    const ok = await store.sendIntent({ t: "hint", word });
    if (ok) setHintText("");
    setSendingHint(false);
  };

  const submitGuess = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingGuess) return;
    const words = [firstAnswer.trim()];
    if (withPiece && secondAnswer.trim().length > 0) words.push(secondAnswer.trim());
    const filtered = words.filter((word) => word.length > 0);
    if (filtered.length === 0) {
      store.showToast(UI.turn.answerEmpty);
      return;
    }
    setSendingGuess(true);
    await store.sendIntent({ t: "guess", words: filtered });
    setSendingGuess(false);
  };

  const passGuess = async () => {
    if (sendingGuess) return;
    setSendingGuess(true);
    await store.sendIntent({ t: "guess", words: [] });
    setSendingGuess(false);
  };

  const revealed = turn.stages.flatMap((item) =>
    item.revealed !== null ? [{ stage: item.index + 1, word: item.revealed.word, score: item.revealed.score }] : [],
  );

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1 data-testid="phase-title" data-phase={view.phase}>
            {phaseTitle}
          </h1>
          <p className="muted">
            {UI.turn.round(view.round + 1, view.totalRounds)} ·{" "}
            {UI.turn.turnProgress(view.turnIndex + 1, view.turnCount)} ·{" "}
            {UI.turn.stage(stageNo, view.rules.stagesPerTurn)}
          </p>
          <p className="setter-line">{UI.turn.setter(setter?.name ?? "—")}</p>
        </div>
        <Timer deadline={view.deadline} clockOffset={clockOffset} />
      </header>

      {isSetter ? (
        <div className="my-word">
          <span className="field-label">{UI.turn.myHiddenWord}</span>
          <strong className="my-word-value" data-testid="my-hidden-word">
            {turn.hiddenWord ?? "—"}
          </strong>
        </div>
      ) : null}

      {isSetter && view.phase === "hint" && !hintCapReached ? (
        <form className="form hint-form" onSubmit={submitHint}>
          <label className="field">
            <span className="field-label">{UI.turn.hintsThisStage}</span>
            <input
              className="input"
              data-testid="hint-input"
              value={hintText}
              onChange={(event) => setHintText(event.target.value)}
              placeholder={UI.turn.hintInputPlaceholder(view.rules.maxWordLength)}
              maxLength={view.rules.maxWordLength}
              disabled={pending}
            />
          </label>
          {pending ? <p className="muted">{UI.turn.hintPending}</p> : null}
          <div className="button-row">
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="hint-submit"
              disabled={pending || sendingHint || hintText.trim().length === 0}
            >
              {UI.turn.hintSubmit}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="stop-hints"
              onClick={() => void store.sendIntent({ t: "stopHints" })}
            >
              {UI.turn.stopHints}
            </button>
          </div>
        </form>
      ) : null}

      {isSetter && view.phase === "hint" && hintCapReached ? (
        <p className="muted">{UI.turn.hintCapReached(view.rules.maxHintsPerStage)}</p>
      ) : null}

      <div className="stages">
        {turn.stages.map((item) => (
          <div className="stage-block" key={item.index}>
            <h2 className="section-title">{UI.turn.stage(item.index + 1, view.rules.stagesPerTurn)}</h2>
            {item.hints.length === 0 ? (
              <p className="muted">{isSetter ? UI.turn.noHintsYet : UI.turn.waitingForHints}</p>
            ) : (
              <ul className="hint-list">
                {item.hints.map((hint) => (
                  <HintCard key={hint.id} hint={hint} rules={view.rules} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <section className="revealed">
        <h2 className="section-title">{UI.turn.revealedThisTurn}</h2>
        {revealed.length === 0 ? (
          <p className="muted">{UI.turn.noRevealedYet}</p>
        ) : (
          <ul className="revealed-list">
            {revealed.map((item) => (
              <li className="revealed-item" key={`${item.stage}-${item.word}`}>
                <span className="revealed-stage muted">{UI.turn.revealedWordAt(item.stage)}</span>
                <strong data-testid="revealed-word">{item.word}</strong>
                <ScoreBand score={item.score} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isSetter && view.phase === "guess" && stage !== null ? (
        submitted ? (
          <p className="notice">{UI.turn.submitted}</p>
        ) : (
          <form className="form guess-form" onSubmit={submitGuess}>
            <h2 className="section-title">{UI.turn.guesserTitle}</h2>
            <input
              className="input"
              data-testid="guess-input"
              value={firstAnswer}
              onChange={(event) => setFirstAnswer(event.target.value)}
              placeholder={UI.turn.guessPlaceholder}
              maxLength={view.rules.maxWordLength}
              autoComplete="off"
              disabled={sendingGuess}
            />
            {withPiece ? (
              <input
                className="input"
                data-testid="guess-input-2"
                value={secondAnswer}
                onChange={(event) => setSecondAnswer(event.target.value)}
                placeholder={UI.turn.guessPlaceholder2}
                maxLength={view.rules.maxWordLength}
                autoComplete="off"
                disabled={sendingGuess}
              />
            ) : null}
            <div className="button-row">
              <button
                type="button"
                className={`btn${withPiece ? " btn-piece-active" : " btn-ghost"}`}
                data-testid="use-piece"
                aria-pressed={withPiece}
                disabled={!canUsePiece || sendingGuess}
                onClick={() => setWithPiece((value) => !value)}
              >
                {UI.turn.usePiece} · {UI.turn.pieceHint(view.me.pieces)}
              </button>
              <button type="submit" className="btn btn-primary" data-testid="guess-submit" disabled={sendingGuess}>
                {UI.turn.submitGuess}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="guess-pass"
                disabled={sendingGuess}
                onClick={() => void passGuess()}
              >
                {UI.turn.pass}
              </button>
            </div>
            {turn.usedPieceThisTurn ? <p className="muted">{UI.turn.pieceUsed}</p> : null}
            {!turn.usedPieceThisTurn && view.me.pieces === 0 ? <p className="muted">{UI.turn.noPiece}</p> : null}
            {mePlayer?.away === true ? <p className="form-error">{UI.turn.awayNotice}</p> : null}
          </form>
        )
      ) : null}

      {view.phase === "guess" ? (
        <div className="submitted">
          <span className="muted">
            {stage !== null ? UI.turn.submittedCount(stage.submittedIds.length, guesserTotal) : null}
          </span>
          <ul className="submitted-list">
            {view.players
              .filter((player) => stage !== null && stage.submittedIds.includes(player.id))
              .map((player) => (
                <li className="chip" key={player.id}>
                  {player.name}
                </li>
              ))}
          </ul>
          {isSetter ? <p className="muted">{UI.turn.setterWaitingGuess}</p> : null}
        </div>
      ) : null}

      {view.phase === "result" && stage !== null ? (
        <StageResult view={view} turn={turn} stage={stage} />
      ) : null}
    </section>
  );
}

function StageResult({ view, turn, stage }: { view: PlayerView; turn: TurnView; stage: StageView }) {
  const nameOf = (playerId: string) =>
    view.players.find((player) => player.id === playerId)?.name ?? "—";
  const gains = Object.entries(stage.guesserGains).filter(([, points]) => points > 0);

  return (
    <section className="stage-result" data-testid="stage-result">
      <h2 className="section-title">{UI.turn.resultTitle}</h2>
      {stage.revealed === null ? (
        <p>{UI.turn.resultNoReveal}</p>
      ) : gains.length > 0 ? (
        <ul className="result-list">
          {gains.map(([playerId, points]) => (
            <li key={playerId}>{UI.turn.resultGuessed(nameOf(playerId), points)}</li>
          ))}
        </ul>
      ) : stage.setterGain > 0 ? (
        <p>{UI.turn.resultSetterGain(nameOf(turn.setterId), stage.setterGain)}</p>
      ) : (
        <p>{UI.turn.resultLowReveal(view.rules.minRevealScoreForSetter)}</p>
      )}
      {turn.outcome === "setter_away" ? <p className="muted">{UI.turn.resultSkippedTurn}</p> : null}
      {turn.outcome !== null && turn.hiddenWord !== null ? (
        <p className="turn-word">{UI.turn.turnEnded(turn.hiddenWord)}</p>
      ) : null}
    </section>
  );
}
