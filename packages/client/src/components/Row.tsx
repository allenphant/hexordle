import { TileState } from "../lib/evaluate";
import { Tile } from "./Tile";

interface RowProps {
  letters: string;
  evaluation?: TileState[];
  reveal?: boolean;
  shake?: boolean;
  wordLength?: number;
  cursorPos?: number;
  onTileClick?: (index: number) => void;
}

export function Row({ letters, evaluation, reveal, shake, wordLength = 6, cursorPos, onTileClick }: RowProps) {
  const tiles = Array(wordLength).fill(null);

  return (
    <div className={`row ${shake ? "row--shake" : ""}`}>
      {tiles.map((_, i) => (
        <Tile
          key={i}
          letter={letters[i]}
          state={evaluation?.[i]}
          reveal={reveal && !!evaluation}
          revealDelay={i * 150}
          isCursor={cursorPos !== undefined && i === cursorPos}
          onClick={onTileClick ? () => onTileClick(i) : undefined}
        />
      ))}
    </div>
  );
}
