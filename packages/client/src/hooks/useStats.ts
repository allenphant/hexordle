import { useState } from "react";
import { GameStatus } from "./useGameState";

export interface Stats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  distribution: [number, number, number, number, number, number];
  lastGameDay: number;
}

const STORAGE_KEY = "hexordle-stats";

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

function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStats();
    return { ...defaultStats(), ...JSON.parse(raw) };
  } catch {
    return defaultStats();
  }
}

function saveStats(stats: Stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

export function useStats() {
  const [stats, setStats] = useState<Stats>(loadStats);

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

      saveStats(next);
      return next;
    });
  };

  return { stats, recordGame };
}
