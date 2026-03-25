import { TileState } from "../lib/evaluate";

interface TileProps {
  letter?: string;
  state?: TileState;
  reveal?: boolean;
  revealDelay?: number;
  active?: boolean;
}

export function Tile({ letter, state, reveal, revealDelay = 0, active }: TileProps) {
  const dataState = reveal && state ? state : letter && !state ? "tbd" : state ?? "empty";

  return (
    <div
      className={`tile ${reveal ? "tile--reveal" : ""} ${active ? "tile--active" : ""}`}
      data-state={dataState}
      style={{ "--reveal-delay": `${revealDelay}ms` } as React.CSSProperties}
    >
      {letter?.toUpperCase()}
    </div>
  );
}
