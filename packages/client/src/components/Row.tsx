import { TileState } from "../lib/evaluate";
import { Tile } from "./Tile";

interface RowProps {
  letters: string;
  evaluation?: TileState[];
  reveal?: boolean;
  shake?: boolean;
}

export function Row({ letters, evaluation, reveal, shake }: RowProps) {
  const tiles = Array(6).fill(null);

  return (
    <div className={`row ${shake ? "row--shake" : ""}`}>
      {tiles.map((_, i) => (
        <Tile
          key={i}
          letter={letters[i]}
          state={evaluation?.[i]}
          reveal={reveal && !!evaluation}
          revealDelay={i * 150}
          active={!evaluation && !!letters[i]}
        />
      ))}
    </div>
  );
}
