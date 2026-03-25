import { TileState } from "./evaluate";

const EMOJI: Record<TileState, string> = {
  correct: "🟩",
  present: "🟨",
  absent: "⬛",
};

export function getDayNumber(): number {
  const epoch = new Date("2026-01-01").getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.floor((today - epoch) / 86_400_000) + 1;
}

export function generateShareText(
  evaluations: TileState[][],
  won: boolean
): string {
  const day = getDayNumber();
  const score = won ? evaluations.length : "X";
  const header = `Hexordle #${day} ${score}/6`;
  const grid = evaluations
    .map((row) => row.map((s) => EMOJI[s]).join(""))
    .join("\n");
  return `${header}\n\n${grid}`;
}
