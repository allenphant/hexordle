import { useEffect, useRef, useState } from "react";
import { AuthData, discordSdk } from "../discordSdk";
import { useGameState } from "../hooks/useGameState";
import { useStats } from "../hooks/useStats";
import { useMultiplayer } from "../hooks/useMultiplayer";
import { Board } from "./Board";
import { Keyboard } from "./Keyboard";
import { ResultModal } from "./ResultModal";
import { SpectatorPanel, GuildRecord } from "./SpectatorPanel";

const TODAY = new Date().toISOString().split("T")[0];

interface GameProps {
  auth: AuthData;
}

export function Game({ auth }: GameProps) {
  const guildId = discordSdk?.guildId ?? undefined;
  const username = auth.user.global_name ?? auth.user.username;

  const [wordLength, setWordLength] = useState<5 | 6 | 7>(6);

  const [state, actions] = useGameState(auth.user.id, guildId, username, auth.user.avatar, wordLength);
  const { stats, recordGame } = useStats(wordLength);
  const { remotePlayers, sendGuess } = useMultiplayer(auth);
  const [showResult, setShowResult] = useState(false);
  const [guildRecords, setGuildRecords] = useState<GuildRecord[]>([]);

  useEffect(() => {
    if (!guildId) return;
    const fetch_ = () => {
      fetch(`/.proxy/api/guild-progress?guildId=${guildId}&date=${TODAY}&wordLength=${wordLength}`)
        .then((r) => r.json())
        .then(setGuildRecords)
        .catch(() => {});
    };
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, [guildId, wordLength]);

  useEffect(() => {
    setShowResult(false);
    prevGuessCount.current = 0;
  }, [wordLength]);

  const prevGuessCount = useRef(state.guesses.length);
  useEffect(() => {
    const newCount = state.guesses.length;
    if (newCount > prevGuessCount.current) {
      const latestEval = state.evaluations[newCount - 1];
      if (latestEval) sendGuess(latestEval);
    }
    prevGuessCount.current = newCount;
  }, [state.guesses.length, state.evaluations, sendGuess]);

  useEffect(() => {
    if (state.gameStatus !== "playing") {
      recordGame(state.gameStatus, state.guesses.length, state.dayNumber);
      const delay = state.gameStatus === "won" ? 1800 : 2200;
      const id = setTimeout(() => setShowResult(true), delay);
      return () => clearTimeout(id);
    }
  }, [state.gameStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="game">
      <header className="header">
        <h1>Hexordle</h1>
        <button
          className="stats-icon"
          onClick={() => state.gameStatus !== "playing" && setShowResult(true)}
          aria-label="Statistics"
          title="Statistics"
        >
          📊
        </button>
      </header>

      {state.toast && <div className="toast">{state.toast}</div>}

      <div className="game-body">
        <div className="game-center">

          {/* Board row: tabs fill the natural left margin beside the board */}
          <div className="board-row">
            <div className="mode-tabs-v">
              {([5, 6, 7] as const).map((n) => (
                <button
                  key={n}
                  className={`mode-tab${wordLength === n ? " mode-tab--active" : ""}`}
                  onClick={() => setWordLength(n)}
                  aria-label={`${n}-letter mode`}
                >
                  {n}
                </button>
              ))}
            </div>

            <Board
              guesses={state.guesses}
              evaluations={state.evaluations}
              currentGuess={state.currentGuess}
              shakeRow={state.shakeRow}
              revealRow={state.revealRow}
              pendingGuess={state.pendingGuess}
              pendingEvaluation={state.pendingEvaluation}
              wordLength={wordLength}
            />

            {/* Mirror spacer keeps the board visually centered */}
            <div className="mode-tabs-mirror" aria-hidden="true" />
          </div>

          <Keyboard
            keyboardColors={state.keyboardColors}
            onKey={actions.onKey}
            isValidating={state.isValidating}
          />
        </div>
      </div>

      <aside className="spectator-aside">
        <SpectatorPanel
          players={remotePlayers}
          guildRecords={guildRecords}
          myUserId={auth.user.id}
          wordLength={wordLength}
        />
      </aside>

      {showResult && state.gameStatus !== "playing" && (
        <ResultModal
          gameStatus={state.gameStatus}
          answer={state.answer}
          evaluations={state.evaluations}
          stats={stats}
          dayNumber={state.dayNumber}
          wordLength={wordLength}
          channelId={discordSdk?.channelId ?? null}
          guildId={discordSdk?.guildId ?? null}
          userId={auth.user.id}
          username={auth.user.global_name ?? auth.user.username}
          avatarHash={auth.user.avatar}
          onClose={() => setShowResult(false)}
        />
      )}
    </div>
  );
}
