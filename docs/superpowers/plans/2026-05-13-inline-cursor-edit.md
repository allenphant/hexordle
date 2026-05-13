# Inline Cursor Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players click any tile in the active guess row to move the cursor there and overwrite that letter.

**Architecture:** Add `cursorPos: number` state and `onTileClick` action to both game hooks; change `currentGuess` from a variable-length prefix string to a fixed-length space-padded string; thread `cursorPos` + `onTileClick` down through Board → Row → Tile; add a blinking CSS cursor indicator.

**Tech Stack:** React 18, TypeScript, Vite, plain CSS

---

## File Map

| File | Change |
|------|--------|
| `packages/client/src/hooks/useGameState.ts` | Fixed-length `currentGuess`; add `cursorPos`; rewrite `onKey`; add `onTileClick` |
| `packages/client/src/hooks/useEquationState.ts` | Same (WORD_LENGTH = 8, equation chars) |
| `packages/client/src/components/Tile.tsx` | Add `isCursor`, `onClick`; fix `dataState` for spaces |
| `packages/client/src/components/Row.tsx` | Add `cursorPos`, `onTileClick`; fix `active` check |
| `packages/client/src/components/Board.tsx` | Forward `cursorPos` + `onTileClick` to active row only |
| `packages/client/src/components/Game.tsx` | Pass `cursorPos` + `onTileClick` from active state/actions to Board |
| `packages/client/src/styles/index.css` | Add `.tile--cursor` + `@keyframes blink-border` |

---

## Task 1: Update `useGameState.ts`

**Files:**
- Modify: `packages/client/src/hooks/useGameState.ts`

### What changes and why

`currentGuess` becomes a fixed-length string (spaces = empty slots) so any position can be edited without shifting other letters. `cursorPos` tracks the active tile index. `onKey` uses `cursorPos` for placement/deletion. `onTileClick` moves the cursor.

- [ ] **Step 1: Add `cursorPos` to `GameState` and `onTileClick` to `GameActions`**

Replace the two interface definitions (lines 100–118):

```ts
export interface GameState {
  answer: string;
  dayNumber: number;
  guesses: string[];
  evaluations: TileState[][];
  currentGuess: string;
  cursorPos: number;             // NEW
  gameStatus: GameStatus;
  shakeRow: boolean;
  revealRow: number | null;
  pendingGuess: string;
  pendingEvaluation: TileState[] | undefined;
  toast: string | null;
  keyboardColors: Map<string, TileState>;
  isValidating: boolean;
}

export interface GameActions {
  onKey: (key: string) => void;
  onTileClick: (index: number) => void;  // NEW
}
```

- [ ] **Step 2: Initialize `currentGuess` as fixed-length padded string and add `cursorPos` state**

Replace the state declarations block (currently around line 155–164) — change the `currentGuess` initial value and add `cursorPos`:

```ts
const [guesses, setGuesses] = useState<string[]>(saved?.guesses ?? []);
const [evaluations, setEvaluations] = useState<TileState[][]>(
  saved?.evaluations ?? []
);
const [currentGuess, setCurrentGuess] = useState(' '.repeat(wordLength));
const [cursorPos, setCursorPos] = useState(0);
const [gameStatus, setGameStatus] = useState<GameStatus>(
  saved?.gameStatus ?? "playing"
);
const [shakeRow, setShakeRow] = useState(false);
const [revealRow, setRevealRow] = useState<number | null>(null);
const [pendingGuess, setPendingGuess] = useState("");
const [pendingEvaluation, setPendingEvaluation] = useState<TileState[] | undefined>(undefined);
const [toast, setToast] = useState<string | null>(null);
const [isValidating, setIsValidating] = useState(false);
```

- [ ] **Step 3: Reset `currentGuess` and `cursorPos` on mode/date switch**

Inside the `useEffect` that watches `[wordLength, today]` (currently around lines 173–192), update the reset block:

```ts
useEffect(() => {
  if (prevWordLengthRef.current === wordLength && prevTodayRef.current === today) return;
  prevWordLengthRef.current = wordLength;
  prevTodayRef.current = today;

  validatingRef.current = false;
  setIsValidating(false);

  const modeState = loadSavedState(wordLength);
  setGuesses(modeState?.guesses ?? []);
  setEvaluations(modeState?.evaluations ?? []);
  setGameStatus(modeState?.gameStatus ?? "playing");
  setCurrentGuess(' '.repeat(wordLength));   // CHANGED from ""
  setCursorPos(0);                            // NEW
  setShakeRow(false);
  setRevealRow(null);
  setPendingGuess("");
  setPendingEvaluation(undefined);
  setToast(null);
}, [wordLength, today]);
```

- [ ] **Step 4: Reset `currentGuess` and `cursorPos` in `submitGuess`**

Inside `submitGuess` callback, replace `setCurrentGuess("")`:

```ts
setCurrentGuess(' '.repeat(wordLength));   // CHANGED
setCursorPos(0);                            // NEW
```

- [ ] **Step 5: Rewrite `onKey` to use cursor-based logic**

Replace the entire `onKey` callback:

```ts
const onKey = useCallback(
  (key: string) => {
    if (gameStatus !== "playing") return;
    if (revealRow !== null) return;
    if (validatingRef.current) return;

    if (key === "Backspace") {
      if (currentGuess[cursorPos] !== ' ') {
        // Delete at cursor, cursor stays
        setCurrentGuess((g) => {
          const chars = g.split('');
          chars[cursorPos] = ' ';
          return chars.join('');
        });
      } else if (cursorPos > 0) {
        // Cursor on empty tile: retreat left and delete
        setCurrentGuess((g) => {
          const chars = g.split('');
          chars[cursorPos - 1] = ' ';
          return chars.join('');
        });
        setCursorPos((p) => p - 1);
      }
      return;
    }

    if (key === "Enter") {
      if (currentGuess.includes(' ')) {   // CHANGED from length check
        setShakeRow(true);
        showToast("Not enough letters");
        setTimeout(() => setShakeRow(false), 600);
        return;
      }

      const word = currentGuess.toLowerCase();
      validatingRef.current = true;
      setIsValidating(true);

      isValidWord(word, wordLength).then((valid) => {
        validatingRef.current = false;
        setIsValidating(false);

        if (!valid) {
          setShakeRow(true);
          showToast("Not in word list");
          setTimeout(() => setShakeRow(false), 600);
          return;
        }

        submitGuess(word);
      });

      return;
    }

    if (/^[a-zA-Z]$/.test(key)) {   // REMOVED length guard (cursor handles bounds)
      setCurrentGuess((g) => {
        const chars = g.split('');
        chars[cursorPos] = key.toLowerCase();
        return chars.join('');
      });
      setCursorPos((p) => Math.min(p + 1, wordLength - 1));
    }
  },
  [gameStatus, revealRow, currentGuess, cursorPos, wordLength, showToast, submitGuess]  // added cursorPos
);
```

- [ ] **Step 6: Add `onTileClick` callback**

Add this after `onKey`:

```ts
const onTileClick = useCallback(
  (index: number) => {
    if (gameStatus !== "playing") return;
    if (revealRow !== null) return;
    if (validatingRef.current) return;
    setCursorPos(index);
  },
  [gameStatus, revealRow]
);
```

- [ ] **Step 7: Add `cursorPos` to the returned state object and `onTileClick` to actions**

Update the `state` object (around line 309) and the return statement:

```ts
const state: GameState = {
  answer,
  dayNumber,
  guesses,
  evaluations,
  currentGuess,
  cursorPos,           // NEW
  gameStatus,
  shakeRow,
  revealRow,
  pendingGuess,
  pendingEvaluation,
  toast,
  keyboardColors,
  isValidating,
};

return [state, { onKey, onTileClick }];   // added onTileClick
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to this file).

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/hooks/useGameState.ts
git commit -m "feat: add cursor state and tile-click action to useGameState"
```

---

## Task 2: Update `useEquationState.ts`

**Files:**
- Modify: `packages/client/src/hooks/useEquationState.ts`

Same changes as Task 1, adapted for the equation hook (`WORD_LENGTH = 8`, uses `EQUATION_INPUT_CHARS` instead of `/^[a-zA-Z]$/`).

- [ ] **Step 1: Add `cursorPos` to `EquationState` and `onTileClick` to `EquationActions`**

Replace the two interface definitions (around lines 102–119):

```ts
export interface EquationState {
  answer: string;
  dayNumber: number;
  guesses: string[];
  evaluations: TileState[][];
  currentGuess: string;
  cursorPos: number;              // NEW
  gameStatus: GameStatus;
  shakeRow: boolean;
  revealRow: number | null;
  pendingGuess: string;
  pendingEvaluation: TileState[] | undefined;
  toast: string | null;
  keyboardColors: Map<string, TileState>;
  isValidating: false;
}

export interface EquationActions {
  onKey: (key: string) => void;
  onTileClick: (index: number) => void;  // NEW
}
```

- [ ] **Step 2: Initialize `currentGuess` as fixed-length and add `cursorPos` state**

Replace the state declarations (around lines 133–141):

```ts
const [guesses,    setGuesses]    = useState<string[]>(saved?.guesses ?? []);
const [evaluations, setEvaluations] = useState<TileState[][]>(saved?.evaluations ?? []);
const [currentGuess, setCurrentGuess] = useState(' '.repeat(WORD_LENGTH));
const [cursorPos, setCursorPos] = useState(0);
const [gameStatus,   setGameStatus]   = useState<GameStatus>(saved?.gameStatus ?? "playing");
const [shakeRow,  setShakeRow]  = useState(false);
const [revealRow, setRevealRow] = useState<number | null>(null);
const [pendingGuess,      setPendingGuess]      = useState("");
const [pendingEvaluation, setPendingEvaluation] = useState<TileState[] | undefined>(undefined);
const [toast, setToast] = useState<string | null>(null);
```

- [ ] **Step 3: Reset on date change**

In the `useEffect` watching `[today]` (around lines 146–159), update resets:

```ts
useEffect(() => {
  if (prevTodayRef.current === today) return;
  prevTodayRef.current = today;
  const s = loadSaved();
  setGuesses(s?.guesses ?? []);
  setEvaluations(s?.evaluations ?? []);
  setGameStatus(s?.gameStatus ?? "playing");
  setCurrentGuess(' '.repeat(WORD_LENGTH));   // CHANGED
  setCursorPos(0);                             // NEW
  setShakeRow(false);
  setRevealRow(null);
  setPendingGuess("");
  setPendingEvaluation(undefined);
  setToast(null);
}, [today]);
```

- [ ] **Step 4: Reset in `submitGuess`**

Inside `submitGuess`, replace `setCurrentGuess("")`:

```ts
setCurrentGuess(' '.repeat(WORD_LENGTH));   // CHANGED
setCursorPos(0);                             // NEW
```

- [ ] **Step 5: Rewrite `onKey`**

Replace the `onKey` callback:

```ts
const onKey = useCallback(
  (key: string) => {
    if (gameStatus !== "playing") return;
    if (revealRow !== null) return;

    const k = normalizeEquationKey(key);

    if (k === "Backspace") {
      if (currentGuess[cursorPos] !== ' ') {
        setCurrentGuess((g) => {
          const chars = g.split('');
          chars[cursorPos] = ' ';
          return chars.join('');
        });
      } else if (cursorPos > 0) {
        setCurrentGuess((g) => {
          const chars = g.split('');
          chars[cursorPos - 1] = ' ';
          return chars.join('');
        });
        setCursorPos((p) => p - 1);
      }
      return;
    }

    if (k === "Enter") {
      if (currentGuess.includes(' ')) {   // CHANGED
        setShakeRow(true);
        showToast("Not enough characters");
        setTimeout(() => setShakeRow(false), 600);
        return;
      }
      const result = isValidEquation(currentGuess);
      if (!result.valid) {
        setShakeRow(true);
        showToast(result.reason);
        setTimeout(() => setShakeRow(false), 600);
        return;
      }
      submitGuess(currentGuess);
      return;
    }

    if (EQUATION_INPUT_CHARS.has(k)) {   // REMOVED length guard
      setCurrentGuess((g) => {
        const chars = g.split('');
        chars[cursorPos] = k;
        return chars.join('');
      });
      setCursorPos((p) => Math.min(p + 1, WORD_LENGTH - 1));
    }
  },
  [gameStatus, revealRow, currentGuess, cursorPos, showToast, submitGuess]  // added cursorPos
);
```

- [ ] **Step 6: Add `onTileClick`**

Add after `onKey`:

```ts
const onTileClick = useCallback(
  (index: number) => {
    if (gameStatus !== "playing") return;
    if (revealRow !== null) return;
    setCursorPos(index);
  },
  [gameStatus, revealRow]
);
```

- [ ] **Step 7: Update return value**

Replace the final return:

```ts
return [
  {
    answer, dayNumber, guesses, evaluations, currentGuess,
    cursorPos,                   // NEW
    gameStatus, shakeRow, revealRow, pendingGuess, pendingEvaluation,
    toast, keyboardColors, isValidating: false,
  },
  { onKey, onTileClick },        // added onTileClick
];
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/hooks/useEquationState.ts
git commit -m "feat: add cursor state and tile-click action to useEquationState"
```

---

## Task 3: Update `Tile.tsx`

**Files:**
- Modify: `packages/client/src/components/Tile.tsx`

Add `isCursor` (shows cursor indicator) and `onClick`. Fix `dataState` so space characters don't trigger the "tbd" style (tbd = tile with letter typed but not yet submitted).

- [ ] **Step 1: Rewrite `Tile.tsx`**

Replace the entire file:

```tsx
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
```

Key changes:
- `filled = !!letter?.trim()` — space is not treated as a letter
- `dataState` uses `filled` instead of `letter` — empty padded tiles stay "empty"
- `isCursor` → adds `tile--cursor` class
- `onClick` + `cursor: pointer` style → all active-row tiles are visually clickable
- Render content only when `filled` — prevents rendering a visible space character

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Tile.tsx
git commit -m "feat: add cursor indicator and click handler to Tile"
```

---

## Task 4: Update `Row.tsx`

**Files:**
- Modify: `packages/client/src/components/Row.tsx`

Add `cursorPos` and `onTileClick` props. Fix `active` to use `.trim()` so space-padded empty tiles don't animate.

- [ ] **Step 1: Rewrite `Row.tsx`**

Replace the entire file:

```tsx
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
          active={!evaluation && !!letters[i]?.trim()}
          isCursor={cursorPos !== undefined && i === cursorPos}
          onClick={onTileClick ? () => onTileClick(i) : undefined}
        />
      ))}
    </div>
  );
}
```

Key changes:
- `active` uses `!!letters[i]?.trim()` — space is not treated as a filled letter
- `isCursor={cursorPos !== undefined && i === cursorPos}` — only the cursor tile gets the indicator
- `onClick` only attached when `onTileClick` is provided (completed rows have no handler)

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Row.tsx
git commit -m "feat: forward cursor position and tile-click to Row tiles"
```

---

## Task 5: Update `Board.tsx`

**Files:**
- Modify: `packages/client/src/components/Board.tsx`

Accept `cursorPos` and `onTileClick`. Pass them only to the active input row; completed rows and empty rows get no click handler.

- [ ] **Step 1: Rewrite `Board.tsx`**

Replace the entire file:

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Board.tsx
git commit -m "feat: forward cursorPos and onTileClick to active row in Board"
```

---

## Task 6: Update `Game.tsx`

**Files:**
- Modify: `packages/client/src/components/Game.tsx`

Pass `cursorPos` and `onTileClick` from the active state/actions to `Board`.

- [ ] **Step 1: Add props to the `<Board>` JSX element**

Find the `<Board ... />` element (around line 233) and add two props:

```tsx
<Board
  guesses={activeState.guesses}
  evaluations={activeState.evaluations}
  currentGuess={activeState.currentGuess}
  shakeRow={activeState.shakeRow}
  revealRow={activeState.revealRow}
  pendingGuess={activeState.pendingGuess}
  pendingEvaluation={activeState.pendingEvaluation}
  wordLength={mode === "eq" ? 8 : mode}
  cursorPos={activeState.cursorPos}
  onTileClick={activeActions.onTileClick}
/>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors. If TypeScript flags `onTileClick` as missing on `activeActions`, confirm that both `GameActions` and `EquationActions` were updated in Tasks 1 and 2.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Game.tsx
git commit -m "feat: wire cursorPos and onTileClick from active state to Board"
```

---

## Task 7: Add cursor CSS

**Files:**
- Modify: `packages/client/src/styles/index.css`

Add the blinking cursor indicator style after the existing tile animation rules.

- [ ] **Step 1: Add `.tile--cursor` and `@keyframes blink-border` after the `@keyframes pop` block**

Find the block ending around line 258:

```css
@keyframes pop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.12); }
  100% { transform: scale(1); }
}
```

Add immediately after it:

```css
.tile--cursor {
  border-color: #999;
  animation: blink-border 1s step-end infinite;
  cursor: pointer;
}

@keyframes blink-border {
  0%, 100% { border-color: #999; }
  50%       { border-color: transparent; }
}
```

All active-row tiles also need `cursor: pointer` to signal they're clickable. Add this in `Tile.tsx` via the `style` prop — when `onClick` is defined, set `cursor: 'pointer'`. Update the `style` line in Tile.tsx (Task 3, Step 1) to:

```tsx
style={{
  "--reveal-delay": `${revealDelay}ms`,
  cursor: onClick ? "pointer" : undefined,
} as React.CSSProperties}
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/styles/index.css
git commit -m "feat: add blinking cursor indicator style for inline tile editing"
```

---

## Task 8: Manual end-to-end verification

Start the dev server:

```bash
cd packages/client && npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`) in a browser.

- [ ] **Test: Keyboard-only typing still works**
  1. Type 6 letters using the keyboard or on-screen keys
  2. Verify each letter appears left-to-right in the tiles
  3. Press Backspace — rightmost letter should disappear (cursor retreats and deletes)
  4. Continue pressing Backspace — letters delete one by one

- [ ] **Test: Click to edit a filled tile**
  1. Type `CASTLE`
  2. Click the tile showing `A` (position 1)
  3. The cursor (blinking border) should appear on `A`
  4. Type `R` — tile changes to `R`, cursor moves to `S` (position 2)
  5. Word is now `CRSTLE`

- [ ] **Test: Click an empty tile**
  1. Clear the row (press Backspace until empty, or start fresh)
  2. Type `CA` (positions 0–1 filled, cursor at position 2)
  3. Click position 4 (empty)
  4. Cursor appears at position 4
  5. Type `E` — `E` appears at position 4, cursor moves to position 5
  6. Word is `CA  E ` (positions 2, 3, 5 still empty)
  7. Press Enter — "Not enough letters" toast appears (correct, has spaces)

- [ ] **Test: Backspace at cursor tile with letter**
  1. Type `CASTLE`
  2. Click the `S` tile (position 2)
  3. Press Backspace — `S` disappears, cursor stays at position 2
  4. Word is now `CA TLE`

- [ ] **Test: Backspace at cursor on empty tile**
  1. Type `CASTLE`
  2. Click `S` (position 2), press Backspace → `CA TLE`, cursor at 2
  3. Press Backspace again — cursor is at empty position 2, so retreats to position 1 and deletes `A`
  4. Word is now `C  TLE`, cursor at position 1

- [ ] **Test: Cursor at last tile stays put**
  1. Type 6 letters (e.g. `CASTLE`)
  2. Cursor should be at position 5 (last tile)
  3. Type another letter — it overwrites position 5, cursor stays at 5

- [ ] **Test: Equation mode (= tab)**
  1. Switch to equation mode (= tab)
  2. Repeat the same click-to-edit tests using the NumericKeyboard
  3. Verify cursor appears and editing works on the 8-character equation board

- [ ] **Test: Submit a valid complete word**
  1. Type a valid 6-letter word (e.g. `CRANE`)
  2. Press Enter
  3. Row flips to reveal colors, cursor resets to position 0 on the next row
