import { useEffect, useRef, useState, useCallback } from "react";
import { AuthData, discordSdk } from "../discordSdk";
import { useGameState } from "../hooks/useGameState";
import { useStats } from "../hooks/useStats";
import { useMultiplayer } from "../hooks/useMultiplayer";
import { Board } from "./Board";
import { Keyboard } from "./Keyboard";
import { ResultModal } from "./ResultModal";
import { SpectatorPanel, GuildRecord } from "./SpectatorPanel";
import { getLocalDate } from "../lib/share";

const TODAY = getLocalDate(); // local date, consistent with server progress keys

interface GameProps {
  auth: AuthData;
}

export function Game({ auth }: GameProps) {
  const guildId = discordSdk?.guildId ?? undefined;
  const username = auth.user.global_name ?? auth.user.username;

  const [wordLength, setWordLength] = useState<5 | 6 | 7>(6);

  const [state, actions] = useGameState(auth.user.id, guildId, username, auth.user.avatar, wordLength);
  const { stats, recordGame } = useStats(wordLength);
  const { remotePlayers, sendProgress } = useMultiplayer(auth);
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
  }, [wordLength]);

  // Send full evaluations whenever guesses change or mode changes (server replaces, never accumulates)
  const prevGuessCount = useRef(state.guesses.length);
  useEffect(() => {
    const newCount = state.guesses.length;
    if (newCount !== prevGuessCount.current) {
      sendProgress(state.evaluations, wordLength);
    }
    prevGuessCount.current = newCount;
  }, [state.guesses.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mode switch, broadcast the new mode's current state so peers see the reset
  const prevWordLengthRef = useRef(wordLength);
  useEffect(() => {
    if (prevWordLengthRef.current !== wordLength) {
      prevWordLengthRef.current = wordLength;
      sendProgress(state.evaluations, wordLength);
    }
  }, [wordLength]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.gameStatus !== "playing") {
      recordGame(state.gameStatus, state.guesses.length, state.dayNumber);
      const delay = state.gameStatus === "won" ? 1800 : 2200;
      const id = setTimeout(() => setShowResult(true), delay);
      return () => clearTimeout(id);
    }
  }, [state.gameStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ResizeObserver: dynamically shrink tiles when height is constrained ──
  const gameRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const recalcSizes = useCallback(() => {
    const el = gameRef.current;
    if (!el) return;

    const h = el.clientHeight;
    const w = el.clientWidth;

    // Width-based tile (mirrors the CSS clamp formula)
    const tileW = Math.min(56, Math.max(32, Math.floor((w - 64) / 7.5)));

    // Height budget: header(50) + board padding(16) + keyboard gap+padding(~30) + spectator(100)
    const FIXED = 50 + 16 + 30 + 100;
    // board = 6 rows × tile + 5 gaps (~tile*0.09)
    // keyboard = 3 rows × key + 2×6 gap
    // key ≈ tile * 0.92
    // total game area ≈ 6*tile + 5*(tile*0.09) + 3*(tile*0.92) + 12
    //                 ≈ tile * (6 + 0.45 + 2.76) + 12 = tile * 9.21 + 12
    const availableForGame = h - FIXED;
    const tileH = Math.max(32, Math.floor((availableForGame - 12) / 9.21));

    const tile = Math.min(tileW, tileH);
    const gap = Math.min(5, Math.max(3, Math.round(tile * 0.09)));
    const key = Math.min(54, Math.max(34, Math.round(tile * 0.92)));

    el.style.setProperty("--tile-size", `${tile}px`);
    el.style.setProperty("--tile-gap", `${gap}px`);
    el.style.setProperty("--key-height", `${key}px`);
  }, []);

  useEffect(() => {
    const el = gameRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recalcSizes);
    });
    ro.observe(el);
    recalcSizes(); // initial calc

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [recalcSizes]);

  return (
    <div className="game" ref={gameRef}>
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
