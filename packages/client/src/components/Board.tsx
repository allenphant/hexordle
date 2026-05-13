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
  cursorPos?: number;
  onTileClick?: (index: number) => void;
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
  cursorPos,
  onTileClick,
}: BoardProps) {
  const rows = Array(6).fill(null);

  return (
    <div className="board" data-word-length={wordLength}>
      {rows.map((_, i) => {
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
          return (
            <Row
              key={i}
              letters={currentGuess}
              shake={shakeRow}
              wordLength={wordLength}
              cursorPos={cursorPos}
              onTileClick={onTileClick}
            />
          );
        }

        return <Row key={i} letters="" wordLength={wordLength} />;
      })}
    </div>
  );
}
