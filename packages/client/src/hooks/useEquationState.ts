import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { TileState, evaluateGuess } from "../lib/evaluate";
import { getDayNumber } from "../lib/share";
import {
  generateDailyEquation,
  isValidEquation,
  EQUATION_INPUT_CHARS,
  normalizeEquationKey,
} from "../lib/equation";
import { GameStatus } from "./useGameState";

const WORD_LENGTH = 8;
const MAX_GUESSES = 6;

interface SavedEquationState {
  guesses: string[];
  evaluations: TileState[][];
  gameStatus: GameStatus;
  dayNumber: number;
}

function loadSaved(): SavedEquationState | null {
  try {
    const raw = localStorage.getItem("hexordle-state-eq");
    if (!raw) return null;
    const saved: SavedEquationState = JSON.parse(raw);
    if (saved.dayNumber !== getDayNumber()) return null;
    return saved;
  } catch {
    return null;
  }
}

function persist(state: SavedEquationState) {
  try {
    localStorage.setItem("hexordle-state-eq", JSON.stringify(state));
  } catch {}
}

async function fetchServer(userId: string, today: string): Promise<SavedEquationState | null> {
  try {
    const res = await fetch(
      `/.proxy/api/progress?userId=${encodeURIComponent(userId)}&date=${today}&wordLength=0`
    );
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

function pushServer(
  userId: string,
  state: SavedEquationState,
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
      wordLength: 0,
    }),
  }).catch(() => {});
}

function deriveKeyboardColors(
  guesses: string[],
  evaluations: TileState[][]
): Map<string, TileState> {
  const priority: Record<TileState, number> = { absent: 1, present: 2, correct: 3 };
  const map = new Map<string, TileState>();
  guesses.forEach((guess, gi) => {
    [...guess].forEach((ch, ci) => {
      const current = map.get(ch);
      const next = evaluations[gi][ci];
      if (!current || priority[next] > priority[current]) map.set(ch, next);
    });
  });
  return map;
}

export interface EquationState {
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
  isValidating: false; // always false — validation is synchronous
}

export interface EquationActions {
  onKey: (key: string) => void;
}

export function useEquationState(
  userId?: string,
  guildId?: string,
  username?: string,
  avatarHash?: string | null,
  today = ""
): [EquationState, EquationActions] {
  const dayNumber = useMemo(() => getDayNumber(), [today]); // eslint-disable-line
  const answer    = useMemo(() => generateDailyEquation(dayNumber), [dayNumber]);

  const saved = loadSaved();
  const [guesses,    setGuesses]    = useState<string[]>(saved?.guesses ?? []);
  const [evaluations, setEvaluations] = useState<TileState[][]>(saved?.evaluations ?? []);
  const [currentGuess, setCurrentGuess] = useState("");
  const [gameStatus,   setGameStatus]   = useState<GameStatus>(saved?.gameStatus ?? "playing");
  const [shakeRow,  setShakeRow]  = useState(false);
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [pendingGuess,      setPendingGuess]      = useState("");
  const [pendingEvaluation, setPendingEvaluation] = useState<TileState[] | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const prevTodayRef = useRef(today);

  // Reset state on date change (midnight rollover)
  useEffect(() => {
    if (prevTodayRef.current === today) return;
    prevTodayRef.current = today;
    const s = loadSaved();
    setGuesses(s?.guesses ?? []);
    setEvaluations(s?.evaluations ?? []);
    setGameStatus(s?.gameStatus ?? "playing");
    setCurrentGuess("");
    setShakeRow(false);
    setRevealRow(null);
    setPendingGuess("");
    setPendingEvaluation(undefined);
    setToast(null);
  }, [today]);

  // Load server progress on mount / date change
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchServer(userId, today).then((srv) => {
      if (cancelled || !srv) return;
      setGuesses((prev) => {
        if (srv.gameStatus !== "playing" || srv.guesses.length > prev.length) {
          setEvaluations(srv.evaluations);
          setGameStatus(srv.gameStatus);
          persist(srv);
          return srv.guesses;
        }
        return prev;
      });
    });
    return () => { cancelled = true; };
  }, [userId, today]); // eslint-disable-line

  const showToast = useCallback((msg: string, dur = 1500) => {
    setToast(msg);
    setTimeout(() => setToast(null), dur);
  }, []);

  const submitGuess = useCallback(
    (guess: string) => {
      const evaluation = evaluateGuess(guess, answer);
      const newGuesses     = [...guesses, guess];
      const newEvaluations = [...evaluations, evaluation];
      const rowIndex = guesses.length;

      setPendingGuess(guess);
      setPendingEvaluation(evaluation);
      setRevealRow(rowIndex);
      setCurrentGuess("");

      setTimeout(() => {
        setRevealRow(null);
        setPendingGuess("");
        setPendingEvaluation(undefined);
        setGuesses(newGuesses);
        setEvaluations(newEvaluations);

        const won  = evaluation.every((s) => s === "correct");
        const lost = !won && newGuesses.length >= MAX_GUESSES;
        const newStatus: GameStatus = won ? "won" : lost ? "lost" : "playing";
        setGameStatus(newStatus);

        const stateToSave = { guesses: newGuesses, evaluations: newEvaluations, gameStatus: newStatus, dayNumber };
        persist(stateToSave);
        if (userId) pushServer(userId, stateToSave, today, guildId, username, avatarHash);

        if (won) {
          const msgs = ["Brilliant!", "Impressive!", "Splendid!", "Great!", "Phew!", "Close one!"];
          showToast(msgs[Math.min(newGuesses.length - 1, 5)], 2500);
        } else if (lost) {
          showToast(answer, 3000);
        }
      }, WORD_LENGTH * 150 + 500);
    },
    [guesses, evaluations, answer, dayNumber, today, showToast] // eslint-disable-line
  );

  const onKey = useCallback(
    (key: string) => {
      if (gameStatus !== "playing") return;
      if (revealRow !== null) return;

      const k = normalizeEquationKey(key);

      if (k === "Backspace") {
        setCurrentGuess((g) => g.slice(0, -1));
        return;
      }

      if (k === "Enter") {
        if (currentGuess.length < WORD_LENGTH) {
          setShakeRow(true);
          showToast("Not enough characters");
          setTimeout(() => setShakeRow(false), 600);
          return;
        }
        const result = isValidEquation(currentGuess);
        if (!result.valid) {
          setShakeRow(true);
          showToast(result.reason);
          setTimeout(() => setShakeRow(false), 600);
          return;
        }
        submitGuess(currentGuess);
        return;
      }

      if (EQUATION_INPUT_CHARS.has(k) && currentGuess.length < WORD_LENGTH) {
        setCurrentGuess((g) => g + k);
      }
    },
    [gameStatus, revealRow, currentGuess, showToast, submitGuess]
  );

  const keyboardColors = deriveKeyboardColors(guesses, evaluations);

  return [
    {
      answer, dayNumber, guesses, evaluations, currentGuess,
      gameStatus, shakeRow, revealRow, pendingGuess, pendingEvaluation,
      toast, keyboardColors, isValidating: false,
    },
    { onKey },
  ];
}
