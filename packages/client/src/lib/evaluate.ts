export type TileState = "correct" | "present" | "absent";

/**
 * Evaluates a guess against the answer.
 * Uses two-pass algorithm: greens first, then yellows.
 * Correctly handles duplicate letters.
 */
export function evaluateGuess(guess: string, answer: string): TileState[] {
  const result: TileState[] = Array(6).fill("absent");
  const answerChars = [...answer];
  const guessChars = [...guess];

  // First pass: mark correct (green)
  for (let i = 0; i < 6; i++) {
    if (guessChars[i] === answerChars[i]) {
      result[i] = "correct";
      answerChars[i] = "#"; // mark as consumed
      guessChars[i] = "*";
    }
  }

  // Second pass: mark present (yellow)
  for (let i = 0; i < 6; i++) {
    if (guessChars[i] === "*") continue;
    const idx = answerChars.indexOf(guessChars[i]);
    if (idx !== -1) {
      result[i] = "present";
      answerChars[idx] = "#"; // mark as consumed
    }
  }

  return result;
}
