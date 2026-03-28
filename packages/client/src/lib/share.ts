import { TileState } from "./evaluate";

const EMOJI: Record<TileState, string> = {
  correct: "🟩",
  present: "🟨",
  absent: "⬛",
};

export function getDayNumber(): number {
  // Both epoch and today use LOCAL midnight so the word changes at 00:00 local time
  const epoch = new Date(2026, 0, 1).getTime(); // Jan 1, 2026 local midnight
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.floor((today - epoch) / 86_400_000) + 1;
}

// Local date string YYYY-MM-DD (used for DB keys, consistent with getDayNumber)
export function getLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function generateShareText(
  evaluations: TileState[][],
  won: boolean,
  wordLength = 6
): string {
  const day = getDayNumber();
  const score = won ? evaluations.length : "X";
  const header = `Hexordle #${day} (${wordLength}L) ${score}/6`;
  const grid = evaluations
    .map((row) => row.map((s) => EMOJI[s]).join(""))
    .join("\n");
  return `${header}\n\n${grid}`;
}
