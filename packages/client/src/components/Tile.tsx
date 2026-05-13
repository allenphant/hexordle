import { TileState } from "../lib/evaluate";

interface TileProps {
  letter?: string;
  state?: TileState;
  reveal?: boolean;
  revealDelay?: number;
  active?: boolean;
  isCursor?: boolean;
  onClick?: () => void;
}

export function Tile({ letter, state, reveal, revealDelay = 0, active, isCursor, onClick }: TileProps) {
  const filled = !!letter?.trim();
  const dataState = reveal && state ? state : filled && !state ? "tbd" : state ?? "empty";

  return (
    <div
      className={`tile ${reveal ? "tile--reveal" : ""} ${active ? "tile--active" : ""} ${isCursor ? "tile--cursor" : ""}`}
      data-state={dataState}
      style={{
        "--reveal-delay": `${revealDelay}ms`,
        cursor: onClick ? "pointer" : undefined,
      } as React.CSSProperties}
      onClick={onClick}
    >
      {filled ? letter!.toUpperCase() : null}
    </div>
  );
}
