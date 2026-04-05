import { useEffect, useRef, useState, useCallback } from "react";
import { AuthData, discordSdk } from "../discordSdk";
import { useGameState } from "../hooks/useGameState";
import { useStats } from "../hooks/useStats";
import { useMultiplayer } from "../hooks/useMultiplayer";
import { Board } from "./Board";
import { Keyboard } from "./Keyboard";
import { ResultModal } from "./ResultModal";
import { SpectatorPanel, GuildRecord } from "./SpectatorPanel";
import { useDateCheck } from "../hooks/useDateCheck";

interface GameProps {
  auth: AuthData;
}

export function Game({ auth }: GameProps) {
  const guildId = discordSdk?.guildId ?? undefined;
  const username = auth.user.global_name ?? auth.user.username;

  const [wordLength, setWordLength] = useState<5 | 6 | 7>(6);
  const today = useDateCheck();

  // Pre-load all three modes simultaneously — mode switching is a pure view change,
  // no async transitions, no race conditions.
  const [state5, actions5] = useGameState(auth.user.id, guildId, username, auth.user.avatar, 5, today);
  const [state6, actions6] = useGameState(auth.user.id, guildId, username, auth.user.avatar, 6, today);
  const [state7, actions7] = useGameState(auth.user.id, guildId, username, auth.user.avatar, 7, today);

  const activeState   = wordLength === 5 ? state5   : wordLength === 7 ? state7   : state6;
  const activeActions = wordLength === 5 ? actions5 : wordLength === 7 ? actions7 : actions6;

  // Per-mode stats (each tracks its own localStorage)
  const { stats: stats5, recordGame: recordGame5 } = useStats(5);
  const { stats: stats6, recordGame: recordGame6 } = useStats(6);
  const { stats: stats7, recordGame: recordGame7 } = useStats(7);
  const activeStats = wordLength === 5 ? stats5 : wordLength === 7 ? stats7 : stats6;

  const { remotePlayers, sendProgress } = useMultiplayer(auth);
  const [showResult, setShowResult] = useState(false);

  // Guild progress pre-fetched for all three modes — instant on mode switch
  const [guildRecords5, setGuildRecords5] = useState<GuildRecord[]>([]);
  const [guildRecords6, setGuildRecords6] = useState<GuildRecord[]>([]);
  const [guildRecords7, setGuildRecords7] = useState<GuildRecord[]>([]);
  const activeGuildRecords = wordLength === 5 ? guildRecords5 : wordLength === 7 ? guildRecords7 : guildRecords6;

  useEffect(() => {
    if (!guildId) return;
    const fetch_ = () =>
      fetch(`/.proxy/api/guild-progress?guildId=${guildId}&date=${today}&wordLength=5`)
        .then((r) => r.json()).then(setGuildRecords5).catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, [guildId, today]);

  useEffect(() => {
    if (!guildId) return;
    const fetch_ = () =>
      fetch(`/.proxy/api/guild-progress?guildId=${guildId}&date=${today}&wordLength=6`)
        .then((r) => r.json()).then(setGuildRecords6).catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, [guildId, today]);

  useEffect(() => {
    if (!guildId) return;
    const fetch_ = () =>
      fetch(`/.proxy/api/guild-progress?guildId=${guildId}&date=${today}&wordLength=7`)
        .then((r) => r.json()).then(setGuildRecords7).catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, [guildId, today]);

  // Close result modal when switching modes
  useEffect(() => {
    setShowResult(false);
  }, [wordLength]);

  // Record stats per mode independently (fires only when that mode's game ends)
  useEffect(() => {
    if (state5.gameStatus !== "playing") recordGame5(state5.gameStatus, state5.guesses.length, state5.dayNumber);
  }, [state5.gameStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state6.gameStatus !== "playing") recordGame6(state6.gameStatus, state6.guesses.length, state6.dayNumber);
  }, [state6.gameStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state7.gameStatus !== "playing") recordGame7(state7.gameStatus, state7.guesses.length, state7.dayNumber);
  }, [state7.gameStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show result modal when the active mode finishes.
  // gameEndKeyRef deduplicates so switching back to a finished mode doesn't re-show.
  const gameEndKeyRef = useRef("");
  useEffect(() => {
    if (activeState.gameStatus !== "playing") {
      const key = `${wordLength}:${activeState.gameStatus}`;
      if (gameEndKeyRef.current === key) return;
      gameEndKeyRef.current = key;
      const delay = activeState.gameStatus === "won" ? 1800 : 2200;
      const id = setTimeout(() => setShowResult(true), delay);
      return () => clearTimeout(id);
    }
  }, [activeState.gameStatus, wordLength]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single keyboard listener routing to the active mode only
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      activeActions.onKey(e.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeActions.onKey]);

  // Send full evaluations whenever active mode's guess count changes
  const prevGuessCountRef = useRef(activeState.guesses.length);
  useEffect(() => {
    const newCount = activeState.guesses.length;
    if (newCount !== prevGuessCountRef.current) {
      sendProgress(activeState.evaluations, wordLength);
    }
    prevGuessCountRef.current = newCount;
  }, [activeState.guesses.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mode switch, broadcast the new mode's current state so peers see it
  const prevWordLengthRef = useRef(wordLength);
  useEffect(() => {
    if (prevWordLengthRef.current !== wordLength) {
      prevWordLengthRef.current = wordLength;
      sendProgress(activeState.evaluations, wordLength);
    }
  }, [wordLength]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ResizeObserver: dynamically shrink tiles when height is constrained ──
  const gameRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const recalcSizes = useCallback(() => {
    const el = gameRef.current;
    if (!el) return;

    const h = el.clientHeight;
    const w = el.clientWidth;

    const tileW = Math.min(56, Math.max(32, Math.floor((w - 64) / 7.5)));

    const FIXED = 50 + 10 + 16 + 30 + 140;
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
    recalcSizes();

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
          onClick={() => activeState.gameStatus !== "playing" && setShowResult(true)}
          aria-label="Statistics"
          title="Statistics"
        >
          📊
        </button>
      </header>

      {activeState.toast && <div className="toast">{activeState.toast}</div>}

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
              guesses={activeState.guesses}
              evaluations={activeState.evaluations}
              currentGuess={activeState.currentGuess}
              shakeRow={activeState.shakeRow}
              revealRow={activeState.revealRow}
              pendingGuess={activeState.pendingGuess}
              pendingEvaluation={activeState.pendingEvaluation}
              wordLength={wordLength}
            />

            {/* Mirror spacer keeps the board visually centered */}
            <div className="mode-tabs-mirror" aria-hidden="true" />
          </div>

          <Keyboard
            keyboardColors={activeState.keyboardColors}
            onKey={activeActions.onKey}
            isValidating={activeState.isValidating}
          />
        </div>
      </div>

      <aside className="spectator-aside">
        <SpectatorPanel
          players={remotePlayers}
          guildRecords={activeGuildRecords}
          myUserId={auth.user.id}
          wordLength={wordLength}
        />
      </aside>

      {showResult && activeState.gameStatus !== "playing" && (
        <ResultModal
          gameStatus={activeState.gameStatus}
          answer={activeState.answer}
          evaluations={activeState.evaluations}
          stats={activeStats}
          dayNumber={activeState.dayNumber}
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
