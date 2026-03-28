import { useState, useEffect, useCallback, useRef } from "react";
import { TileState, evaluateGuess } from "../lib/evaluate";
import { getDailyAnswer } from "../lib/words";
import { getDayNumber, getLocalDate } from "../lib/share";

export type GameStatus = "playing" | "won" | "lost";

interface SavedGameState {
  guesses: string[];
  evaluations: TileState[][];
  gameStatus: GameStatus;
  dayNumber: number;
}

const TODAY = getLocalDate(); // YYYY-MM-DD local date — consistent with getDayNumber()

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

async function fetchServerProgress(userId: string, wordLength: number): Promise<SavedGameState | null> {
  try {
    const res = await fetch(`/.proxy/api/progress?userId=${encodeURIComponent(userId)}&date=${TODAY}&wordLength=${wordLength}`);
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
  guildId?: string,
  username?: string,
  avatarHash?: string | null
) {
  fetch("/.proxy/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      date: TODAY,
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
  wordLength = 6
): [GameState, GameActions] {
  const answer = getDailyAnswer(wordLength);
  const dayNumber = getDayNumber();

  const saved = loadSavedState(wordLength);

  const [guesses, setGuesses] = useState<string[]>(saved?.guesses ?? []);
  const [evaluations, setEvaluations] = useState<TileState[][]>(
    saved?.evaluations ?? []
  );
  const [currentGuess, setCurrentGuess] = useState("");
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
  // Track previous wordLength to detect mode switches
  const prevWordLengthRef = useRef(wordLength);

  // When wordLength changes: restore saved state for new mode (or fresh state)
  useEffect(() => {
    if (prevWordLengthRef.current === wordLength) return;
    prevWordLengthRef.current = wordLength;

    // Cancel any in-flight validation
    validatingRef.current = false;
    setIsValidating(false);

    const modeState = loadSavedState(wordLength);
    setGuesses(modeState?.guesses ?? []);
    setEvaluations(modeState?.evaluations ?? []);
    setGameStatus(modeState?.gameStatus ?? "playing");
    setCurrentGuess("");
    setShakeRow(false);
    setRevealRow(null);
    setPendingGuess("");
    setPendingEvaluation(undefined);
    setToast(null);
  }, [wordLength]);

  // On mount or wordLength change: load progress from server (overrides localStorage if server has more)
  useEffect(() => {
    if (!userId) return;
    fetchServerProgress(userId, wordLength).then((serverState) => {
      if (!serverState) return;
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
  }, [userId, wordLength]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setCurrentGuess("");

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
        if (userId) saveServerProgress(userId, stateToSave, wordLength, guildId, username, avatarHash);

        if (won) {
          const messages = ["Brilliant!", "Impressive!", "Splendid!", "Great!", "Phew!", "Close one!"];
          showToast(messages[Math.min(newGuesses.length - 1, 5)], 2500);
        } else if (lost) {
          showToast(answer.toUpperCase(), 3000);
        }
      }, REVEAL_DURATION);
    },
    [guesses, evaluations, answer, dayNumber, wordLength, showToast]
  );

  const onKey = useCallback(
    (key: string) => {
      if (gameStatus !== "playing") return;
      if (revealRow !== null) return;
      if (validatingRef.current) return;

      if (key === "Backspace") {
        setCurrentGuess((g) => g.slice(0, -1));
        return;
      }

      if (key === "Enter") {
        if (currentGuess.length < wordLength) {
          setShakeRow(true);
          showToast("Not enough letters");
          setTimeout(() => setShakeRow(false), 600);
          return;
        }

        const word = currentGuess.toLowerCase();
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

      if (/^[a-zA-Z]$/.test(key) && currentGuess.length < wordLength) {
        setCurrentGuess((g) => g + key.toLowerCase());
      }
    },
    [gameStatus, revealRow, currentGuess, wordLength, showToast, submitGuess]
  );

  // Physical keyboard listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      onKey(e.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onKey]);

  const keyboardColors = deriveKeyboardColors(guesses, evaluations);

  const state: GameState = {
    answer,
    dayNumber,
    guesses,
    evaluations,
    currentGuess,
    gameStatus,
    shakeRow,
    revealRow,
    pendingGuess,
    pendingEvaluation,
    toast,
    keyboardColors,
    isValidating,
  };

  return [state, { onKey }];
}
