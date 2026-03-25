import { TileState } from "../lib/evaluate";
import { GameActions } from "../hooks/useGameState";

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["Enter", "z", "x", "c", "v", "b", "n", "m", "Backspace"],
];

interface KeyboardProps {
  keyboardColors: Map<string, TileState>;
  onKey: GameActions["onKey"];
  isValidating?: boolean;
}

export function Keyboard({ keyboardColors, onKey, isValidating }: KeyboardProps) {
  return (
    <div className="keyboard" style={isValidating ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      {ROWS.map((row, ri) => (
        <div key={ri} className="keyboard-row">
          {row.map((key) => {
            const state = keyboardColors.get(key);
            return (
              <button
                key={key}
                className={`key ${key === "Enter" || key === "Backspace" ? "key--wide" : ""}`}
                data-state={state ?? ""}
                onClick={() => onKey(key)}
                aria-label={key}
              >
                {key === "Backspace" ? "⌫" : key.toUpperCase()}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
