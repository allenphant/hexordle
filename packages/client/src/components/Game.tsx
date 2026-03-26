import { useEffect, useRef, useState } from "react";
import { TileState } from "../lib/evaluate";
import { AuthData, discordSdk } from "../discordSdk";
import { useGameState } from "../hooks/useGameState";
import { useStats } from "../hooks/useStats";
import { useMultiplayer } from "../hooks/useMultiplayer";
import { Board } from "./Board";
import { Keyboard } from "./Keyboard";
import { ResultModal } from "./ResultModal";
import { SpectatorPanel } from "./SpectatorPanel";

const TODAY = new Date().toISOString().split("T")[0];

export interface GuildRecord {
  userId: string;
  username: string;
  evaluations: TileState[][];
  completed: boolean;
  won: boolean;
}

interface GameProps {
  auth: AuthData;
}

export function Game({ auth }: GameProps) {
  const guildId = discordSdk?.guildId ?? undefined;
  const username = auth.user.global_name ?? auth.user.username;
  const [state, actions] = useGameState(auth.user.id, guildId, username);
  const { stats, recordGame } = useStats();
  const { remotePlayers, sendGuess } = useMultiplayer(auth);
  const [showResult, setShowResult] = useState(false);
  const [guildRecords, setGuildRecords] = useState<GuildRecord[]>([]);

  // Fetch all guild members' daily records (refresh every 30s)
  useEffect(() => {
    if (!guildId) return;
    const fetch_ = () => {
      fetch(`/.proxy/api/guild-progress?guildId=${guildId}&date=${TODAY}`)
        .then((r) => r.json())
        .then(setGuildRecords)
        .catch(() => {});
    };
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, [guildId]);

  // Track previous guesses count to detect new guesses and send to spectators
  const prevGuessCount = useRef(state.guesses.length);
  useEffect(() => {
    const newCount = state.guesses.length;
    if (newCount > prevGuessCount.current) {
      const latestEval = state.evaluations[newCount - 1];
      if (latestEval) sendGuess(latestEval);
    }
    prevGuessCount.current = newCount;
  }, [state.guesses.length, state.evaluations, sendGuess]);

  // Record stats and show result modal when game ends
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

      <div className="game-main">
        <Board
          guesses={state.guesses}
          evaluations={state.evaluations}
          currentGuess={state.currentGuess}
          shakeRow={state.shakeRow}
          revealRow={state.revealRow}
          pendingGuess={state.pendingGuess}
          pendingEvaluation={state.pendingEvaluation}
        />

        {(remotePlayers.length > 0 || guildRecords.length > 0) && (
          <SpectatorPanel
            players={remotePlayers}
            guildRecords={guildRecords}
            myUserId={auth.user.id}
          />
        )}
      </div>

      <Keyboard
        keyboardColors={state.keyboardColors}
        onKey={actions.onKey}
        isValidating={state.isValidating}
      />

      {showResult && state.gameStatus !== "playing" && (
        <ResultModal
          gameStatus={state.gameStatus}
          answer={state.answer}
          evaluations={state.evaluations}
          stats={stats}
          dayNumber={state.dayNumber}
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
