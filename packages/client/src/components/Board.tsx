import { TileState } from "../lib/evaluate";
import { Row } from "./Row";

interface BoardProps {
  guesses: string[];
  evaluations: TileState[][];
  currentGuess: string;
  shakeRow: boolean;
  revealRow: number | null;
  pendingGuess?: string;
  pendingEvaluation?: TileState[];
  wordLength?: number;
}

export function Board({
  guesses,
  evaluations,
  currentGuess,
  shakeRow,
  revealRow,
  pendingGuess,
  pendingEvaluation,
  wordLength = 6,
}: BoardProps) {
  const rows = Array(6).fill(null);

  return (
    <div className="board" data-word-length={wordLength}>
      {rows.map((_, i) => {
        // Row currently being revealed (animation phase)
        if (revealRow !== null && i === revealRow) {
          return (
            <Row
              key={i}
              letters={pendingGuess ?? ""}
              evaluation={pendingEvaluation}
              reveal
              shake={false}
              wordLength={wordLength}
            />
          );
        }

        if (i < guesses.length) {
          // Completed row
          return (
            <Row
              key={i}
              letters={guesses[i]}
              evaluation={evaluations[i]}
              reveal={false}
              shake={false}
              wordLength={wordLength}
            />
          );
        }

        if (revealRow === null && i === guesses.length) {
          // Active input row
          return (
            <Row
              key={i}
              letters={currentGuess}
              shake={shakeRow}
              wordLength={wordLength}
            />
          );
        }

        // Empty row
        return <Row key={i} letters="" wordLength={wordLength} />;
      })}
    </div>
  );
}
