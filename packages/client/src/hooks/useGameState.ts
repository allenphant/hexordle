import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { TileState, evaluateGuess } from "../lib/evaluate";
import { getDailyAnswer } from "../lib/words";
import { getDayNumber } from "../lib/share";

export type GameStatus = "playing" | "won" | "lost";

interface SavedGameState {
  guesses: string[];
  evaluations: TileState[][];
  gameStatus: GameStatus;
  dayNumber: number;
}

function storageKey(wordLength: number) {
  return `hexordle-state-${wordLength}`;
}

function loadSavedState(wordLength: number): SavedGameState | null {
  try {
    const raw = localStorage.getItem(storageKey(wordLength));
    if (!raw) return null;
    const saved: SavedGameState = JSON.parse(raw);
    if (saved.dayNumber !== getDayNumber()) return null;
    return saved;
  } catch {
    return null;
  }
}

function saveState(state: SavedGameState, wordLength: number) {
  try {
    localStorage.setItem(storageKey(wordLength), JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

async function fetchServerProgress(userId: string, wordLength: number, today: string): Promise<SavedGameState | null> {
  try {
    const res = await fetch(`/.proxy/api/progress?userId=${encodeURIComponent(userId)}&date=${today}&wordLength=${wordLength}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data) return null;
    return {
      guesses: data.guesses ?? [],
      evaluations: data.evaluations ?? [],
      gameStatus: data.completed ? (data.won ? "won" : "lost") : "playing",
      dayNumber: getDayNumber(),
    };
  } catch {
    return null;
  }
}

function saveServerProgress(
  userId: string,
  state: SavedGameState,
  wordLength: number,
  today: string,
  guildId?: string,
  username?: string,
  avatarHash?: string | null
) {
  fetch("/.proxy/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      date: today,
      dayNumber: state.dayNumber,
      guesses: state.guesses,
      evaluations: state.evaluations,
      completed: state.gameStatus !== "playing",
      won: state.gameStatus === "won",
      guildId,
      username,
      avatarHash,
      wordLength,
    }),
  }).catch(() => {}); // fire-and-forget
}

// Module-level cache so it persists across re-renders
const validWordCache = new Map<string, boolean>();

async function isValidWord(word: string, wordLength: number): Promise<boolean> {
  const cacheKey = `${wordLength}:${word}`;
  if (validWordCache.has(cacheKey)) return validWordCache.get(cacheKey)!;
  try {
    const res = await fetch(`/.proxy/api/validate?word=${word}&length=${wordLength}`);
    const { valid } = await res.json();
    validWordCache.set(cacheKey, valid);
    return valid;
  } catch {
    return true; // network failure → allow the word
  }
}

export interface GameState {
  answer: string;
  dayNumber: number;
  guesses: string[];
  evaluations: TileState[][];
  currentGuess: string;
  cursorPos: number;
  gameStatus: GameStatus;
  shakeRow: boolean;
  revealRow: number | null;
  pendingGuess: string;
  pendingEvaluation: TileState[] | undefined;
  toast: string | null;
  keyboardColors: Map<string, TileState>;
  isValidating: boolean;
}

export interface GameActions {
  onKey: (key: string) => void;
  onTileClick: (index: number) => void;
}

function deriveKeyboardColors(
  guesses: string[],
  evaluations: TileState[][]
): Map<string, TileState> {
  const priority: Record<TileState, number> = { absent: 1, present: 2, correct: 3 };
  const map = new Map<string, TileState>();
  guesses.forEach((guess, gi) => {
    [...guess].forEach((letter, li) => {
      const current = map.get(letter);
      const next = evaluations[gi][li];
      if (!current || priority[next] > priority[current]) {
        map.set(letter, next);
      }
    });
  });
  return map;
}

export function useGameState(
  userId?: string,
  guildId?: string,
  username?: string,
  avatarHash?: string | null,
  wordLength = 6,
  today = ""
): [GameState, GameActions] {
  const dayNumber = useMemo(() => getDayNumber(), [today]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = useMemo(() => getDailyAnswer(wordLength), [wordLength, dayNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = loadSavedState(wordLength);

  const [guesses, setGuesses] = useState<string[]>(saved?.guesses ?? []);
  const [evaluations, setEvaluations] = useState<TileState[][]>(
    saved?.evaluations ?? []
  );
  const [currentGuess, setCurrentGuess] = useState(' '.repeat(wordLength));
  const [cursorPos, setCursorPos] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>(
    saved?.gameStatus ?? "playing"
  );
  const [shakeRow, setShakeRow] = useState(false);
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [pendingGuess, setPendingGuess] = useState("");
  const [pendingEvaluation, setPendingEvaluation] = useState<TileState[] | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Ref to track if a validation is already in flight (prevents double-submit)
  const validatingRef = useRef(false);
  // Track previous values to detect mode switches and date changes
  const prevWordLengthRef = useRef(wordLength);
  const prevTodayRef = useRef(today);

  // When wordLength or date changes: restore saved state (or fresh state for new day)
  useEffect(() => {
    if (prevWordLengthRef.current === wordLength && prevTodayRef.current === today) return;
    prevWordLengthRef.current = wordLength;
    prevTodayRef.current = today;

    // Cancel any in-flight validation
    validatingRef.current = false;
    setIsValidating(false);

    const modeState = loadSavedState(wordLength);
    setGuesses(modeState?.guesses ?? []);
    setEvaluations(modeState?.evaluations ?? []);
    setGameStatus(modeState?.gameStatus ?? "playing");
    setCurrentGuess(' '.repeat(wordLength));
    setCursorPos(0);
    setShakeRow(false);
    setRevealRow(null);
    setPendingGuess("");
    setPendingEvaluation(undefined);
    setToast(null);
  }, [wordLength, today]);

  // On mount, wordLength change, or date change: load progress from server
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchServerProgress(userId, wordLength, today).then((serverState) => {
      if (cancelled || !serverState) return;
      // Server wins if it has a completed game or more guesses than local
      setGuesses((prev) => {
        if (serverState.gameStatus !== "playing" || serverState.guesses.length > prev.length) {
          setEvaluations(serverState.evaluations);
          setGameStatus(serverState.gameStatus);
          saveState(serverState, wordLength);
          return serverState.guesses;
        }
        return prev;
      });
    });
    return () => { cancelled = true; };
  }, [userId, wordLength, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((message: string, duration = 1500) => {
    setToast(message);
    setTimeout(() => setToast(null), duration);
  }, []);

  const submitGuess = useCallback(
    (guess: string) => {
      const evaluation = evaluateGuess(guess, answer.toLowerCase());
      const newGuesses = [...guesses, guess];
      const newEvaluations = [...evaluations, evaluation];
      const rowIndex = guesses.length;

      setPendingGuess(guess);
      setPendingEvaluation(evaluation);
      setRevealRow(rowIndex);
      setCurrentGuess(' '.repeat(wordLength));
      setCursorPos(0);

      const REVEAL_DURATION = wordLength * 150 + 500;

      setTimeout(() => {
        setRevealRow(null);
        setPendingGuess("");
        setPendingEvaluation(undefined);
        setGuesses(newGuesses);
        setEvaluations(newEvaluations);

        const won = evaluation.every((s) => s === "correct");
        const lost = !won && newGuesses.length >= 6;
        const newStatus: GameStatus = won ? "won" : lost ? "lost" : "playing";
        setGameStatus(newStatus);

        const stateToSave = { guesses: newGuesses, evaluations: newEvaluations, gameStatus: newStatus, dayNumber };
        saveState(stateToSave, wordLength);
        if (userId) saveServerProgress(userId, stateToSave, wordLength, today, guildId, username, avatarHash);

        if (won) {
          const messages = ["Brilliant!", "Impressive!", "Splendid!", "Great!", "Phew!", "Close one!"];
          showToast(messages[Math.min(newGuesses.length - 1, 5)], 2500);
        } else if (lost) {
          showToast(answer.toUpperCase(), 3000);
        }
      }, REVEAL_DURATION);
    },
    [guesses, evaluations, answer, dayNumber, wordLength, today, showToast]
  );

  const onKey = useCallback(
    (key: string) => {
      const pos = cursorPos;  // snapshot to avoid stale-closure in updaters
      if (gameStatus !== "playing") return;
      if (revealRow !== null) return;
      if (validatingRef.current) return;

      if (key === "Backspace") {
        if (currentGuess[pos] !== ' ') {
          setCurrentGuess((g) => {
            const chars = g.split('');
            chars[pos] = ' ';
            return chars.join('');
          });
        } else if (pos > 0) {
          setCurrentGuess((g) => {
            const chars = g.split('');
            chars[pos - 1] = ' ';
            return chars.join('');
          });
          setCursorPos((p) => p - 1);
        }
        return;
      }

      if (key === "Enter") {
        if (currentGuess.includes(' ')) {
          setShakeRow(true);
          showToast("Not enough letters");
          setTimeout(() => setShakeRow(false), 600);
          return;
        }

        const word = currentGuess;
        validatingRef.current = true;
        setIsValidating(true);

        isValidWord(word, wordLength).then((valid) => {
          validatingRef.current = false;
          setIsValidating(false);

          if (!valid) {
            setShakeRow(true);
            showToast("Not in word list");
            setTimeout(() => setShakeRow(false), 600);
            return;
          }

          submitGuess(word);
        });

        return;
      }

      if (/^[a-zA-Z]$/.test(key)) {
        setCurrentGuess((g) => {
          const chars = g.split('');
          chars[pos] = key.toLowerCase();
          return chars.join('');
        });
        setCursorPos((p) => Math.min(p + 1, wordLength - 1));
      }
    },
    [gameStatus, revealRow, currentGuess, cursorPos, wordLength, showToast, submitGuess]
  );

  const onTileClick = useCallback(
    (index: number) => {
      if (gameStatus !== "playing") return;
      if (revealRow !== null) return;
      if (validatingRef.current) return;
      setCursorPos(index);
    },
    [gameStatus, revealRow]
  );

  const keyboardColors = deriveKeyboardColors(guesses, evaluations);

  const state: GameState = {
    answer,
    dayNumber,
    guesses,
    evaluations,
    currentGuess,
    cursorPos,
    gameStatus,
    shakeRow,
    revealRow,
    pendingGuess,
    pendingEvaluation,
    toast,
    keyboardColors,
    isValidating,
  };

  return [state, { onKey, onTileClick }];
}
