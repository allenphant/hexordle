import { useState, useEffect, useRef } from "react";
import { GameStatus } from "./useGameState";

export interface Stats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  distribution: [number, number, number, number, number, number];
  lastGameDay: number;
}

function storageKey(wordLength: number) {
  return `hexordle-stats-${wordLength}`;
}

function defaultStats(): Stats {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    distribution: [0, 0, 0, 0, 0, 0],
    lastGameDay: 0,
  };
}

function loadStats(wordLength: number): Stats {
  try {
    const raw = localStorage.getItem(storageKey(wordLength));
    if (!raw) return defaultStats();
    return { ...defaultStats(), ...JSON.parse(raw) };
  } catch {
    return defaultStats();
  }
}

function saveStats(stats: Stats, wordLength: number) {
  try {
    localStorage.setItem(storageKey(wordLength), JSON.stringify(stats));
  } catch {
    // ignore
  }
}

export function useStats(wordLength = 6) {
  const [stats, setStats] = useState<Stats>(() => loadStats(wordLength));
  const prevRef = useRef(wordLength);

  useEffect(() => {
    if (prevRef.current === wordLength) return;
    prevRef.current = wordLength;
    setStats(loadStats(wordLength));
  }, [wordLength]);

  const recordGame = (status: GameStatus, guessCount: number, dayNumber: number) => {
    setStats((prev) => {
      if (prev.lastGameDay === dayNumber) return prev; // already recorded

      const won = status === "won";
      const newDistribution = [...prev.distribution] as Stats["distribution"];
      if (won) newDistribution[guessCount - 1]++;

      const streak = won
        ? prev.lastGameDay === dayNumber - 1
          ? prev.currentStreak + 1
          : 1
        : 0;

      const next: Stats = {
        gamesPlayed: prev.gamesPlayed + 1,
        gamesWon: prev.gamesWon + (won ? 1 : 0),
        currentStreak: streak,
        maxStreak: Math.max(prev.maxStreak, streak),
        distribution: newDistribution,
        lastGameDay: dayNumber,
      };

      saveStats(next, wordLength);
      return next;
    });
  };

  return { stats, recordGame };
}
