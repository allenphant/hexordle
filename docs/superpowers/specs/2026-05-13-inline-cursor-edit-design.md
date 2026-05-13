# Inline Cursor Editing Design

**Date:** 2026-05-13  
**Feature:** Click-to-edit tile in the active guess row

---

## Overview

Currently, if a player mistype a letter they must delete from the rightmost position and retype. This spec adds a cursor-based inline editing system: clicking any tile in the active row moves the cursor there, and the next keystroke replaces that letter.

---

## Behavior

### Clicking a tile
- Clicking any tile in the **current (active) input row** sets `cursorPos` to that tile's index.
- Clicking tiles in completed rows or during reveal animation has no effect.
- Clicking is disabled while word validation is in flight (`isValidating`).

### Typing a letter
- The letter is placed at `cursorPos`.
- `cursorPos` advances to `min(cursorPos + 1, wordLength - 1)`.
- If `cursorPos` is already at the last position, it stays there.

### Backspace
- If the tile at `cursorPos` has a letter → delete it, cursor stays at `cursorPos`.
- If the tile at `cursorPos` is empty AND `cursorPos > 0` → cursor retreats to `cursorPos - 1` and deletes the letter there.
- If the tile at `cursorPos` is empty AND `cursorPos = 0` → no-op.

This rule preserves natural keyboard-only behavior (typing A-B-C leaves cursor after C; Backspace retreats and deletes C) while also supporting the click-then-delete workflow.

### Submitting (Enter)
- "Not enough letters" condition changes from `currentGuess.length < wordLength` to `currentGuess.includes(' ')`.
- After successful submission, `currentGuess` resets to `' '.repeat(wordLength)` and `cursorPos` resets to `0`.

### Mode switch / date change
- `currentGuess` resets to `' '.repeat(wordLength)` for the new mode's word length.
- `cursorPos` resets to `0`.

---

## State Model

### `currentGuess` representation
Changes from a variable-length prefix string (e.g. `"CAR"`) to a **fixed-length padded string** always equal to `wordLength` characters. Empty positions are represented by `' '` (space). Examples:

| Input state | String |
|-------------|--------|
| Nothing typed | `"      "` (6 spaces) |
| Typed CAR | `"CAR   "` |
| Typed C, clicked pos 4, typed E | `"C   E "` |

### New state fields

| Field | Type | Initial value | Description |
|-------|------|---------------|-------------|
| `cursorPos` | `number` | `0` | Index of the currently active tile (0-based) |

### Updated interfaces

**`GameState` / `EquationState`** — add:
```ts
cursorPos: number;
```

**`GameActions` / `EquationActions`** — add:
```ts
onTileClick: (index: number) => void;
```

---

## Component Changes

### Data flow

```
Game.tsx
  → Board: +cursorPos, +onTileClick
    → Row (active row only): +cursorPos, +onTileClick
      → Tile: +isCursor, +onClick
```

### `Game.tsx`
Pass `activeState.cursorPos` and `activeActions.onTileClick` to `<Board>`.

### `Board.tsx`
- New props: `cursorPos: number`, `onTileClick: (i: number) => void`
- Pass them only to the active input row. Completed rows and empty rows receive no click handler.

### `Row.tsx`
- New optional props: `cursorPos?: number`, `onTileClick?: (i: number) => void`
- For each tile: `isCursor={i === cursorPos}`, `onClick={() => onTileClick?.(i)}`

### `Tile.tsx`
- New optional props: `isCursor?: boolean`, `onClick?: () => void`
- Apply class `tile--cursor` when `isCursor` is true.

### `Row.tsx` — `active` fix
Change `active={!evaluation && !!letters[i]}` to `active={!evaluation && !!letters[i]?.trim()}` so space-padded empty tiles are not incorrectly marked active.

---

## Visual

`.tile--cursor` — cursor indicator on the active tile:
```css
.tile--cursor {
  border-color: #999;
  animation: blink-border 1s step-end infinite;
}

@keyframes blink-border {
  0%, 100% { border-color: #999; }
  50%       { border-color: transparent; }
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `packages/client/src/hooks/useGameState.ts` | Fixed-length `currentGuess`; add `cursorPos`; rewrite `onKey` insert/delete logic; add `onTileClick`; update resets |
| `packages/client/src/hooks/useEquationState.ts` | Same changes (`WORD_LENGTH = 8`) |
| `packages/client/src/components/Board.tsx` | Accept + forward `cursorPos` / `onTileClick` to active row |
| `packages/client/src/components/Row.tsx` | Accept + forward `cursorPos` / `onTileClick` per tile |
| `packages/client/src/components/Tile.tsx` | Add `isCursor`, `onClick` |
| `packages/client/src/components/Row.tsx` | Fix `active` check (`!!letters[i]?.trim()`); add cursor/click props per tile |
| `packages/client/src/components/Game.tsx` | Pass `cursorPos` + `onTileClick` to `Board` |
| CSS (index.css or equivalent) | Add `.tile--cursor` + `@keyframes blink-border` |

---

## Out of Scope

- Cursor on completed (submitted) rows — no editing after submission.
- Cursor on spectator / other players' boards.
- Multi-character selection or drag-to-select.
