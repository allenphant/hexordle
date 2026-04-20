import { TileState } from "../lib/evaluate";

// Key values must match the Unicode chars in equation.ts exactly
const ROWS: string[][] = [
  ["1", "2", "3", "+", "\u2212"],       // − MINUS SIGN
  ["4", "5", "6", "\u00D7", "\u00F7"],  // × ÷
  ["7", "8", "9", "=", "\u00B2"],       // ²
  ["0", "(", ")", "Backspace"],
  ["Enter"],
];

interface NumericKeyboardProps {
  keyboardColors: Map<string, TileState>;
  onKey: (key: string) => void;
}

export function NumericKeyboard({ keyboardColors, onKey }: NumericKeyboardProps) {
  return (
    <div className="keyboard">
      {ROWS.map((row, ri) => (
        <div key={ri} className="keyboard-row">
          {row.map((key) => {
            const state  = keyboardColors.get(key);
            const isWide = key === "Enter" || key === "Backspace";
            return (
              <button
                key={key}
                className={`key${isWide ? " key--wide" : ""}`}
                data-state={state ?? ""}
                onClick={() => onKey(key)}
                aria-label={key}
              >
                {key === "Backspace" ? "\u232B" : key}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
