# Number Mode Design

**Date:** 2026-04-20  
**Status:** Approved

## Overview

Add a fourth game mode ("Equation mode") to Hexordle alongside the existing 5-, 6-, and 7-letter word modes. Players guess a hidden 8-character math equation using color feedback identical to Wordle (green = correct position, yellow = present but wrong position, gray = absent).

---

## 1. Game Mode Type

`GameMode` replaces the current `wordLength: 5 | 6 | 7` union:

```typescript
type GameMode = 5 | 6 | 7 | "eq"
```

The new `"eq"` variant activates equation mode throughout the app. All existing `wordLength` logic remains unchanged; only `"eq"` triggers alternative code paths.

---

## 2. Equation Format

- **Length:** exactly 8 characters (Unicode code points)
- **Character set:** `0–9`, `+`, `−`, `×`, `÷`, `=`, `²`, `(`, `)`
- **Constraint:** exactly one `=` sign; no leading zeros on multi-digit numbers

### Supported templates (examples, not exhaustive)

| Template | Example |
|----------|---------|
| `A+B=C` | `12+34=46` |
| `A−B=C` | `34−12=22` |
| `A×B=C` | `25×4=100` |
| `A÷B=C` | `120÷6=20` |
| `A²+B=C` | `3²+10=19` |
| `A+B²=C` | `10+3²=19` |
| `(A×B)=C` | `(3×5)=15` |
| `A×B+C=D` | `3×4+2=14` |

---

## 3. Equation Generation (`lib/equation.ts`)

### When

Generated on-demand when the app mounts (or the `"eq"` tab is first activated), seeded by `getDayNumber()`. Runs in under 1 ms — no loading state required, no async, no midnight scheduling.

### Algorithm

Uses the same LCG seeded shuffle as word mode (`seed = Math.imul(seed, 1664525) + 1013904223 >>> 0`).

```
function generateDailyEquation(dayNumber: number): string {
  let seed = dayNumber * 0x9e3779b9;
  for (let attempt = 0; attempt < 200; attempt++) {
    seed = lcg(seed);
    const candidate = tryTemplate(seed);
    if (candidate && candidate.length === 8 && isValidEquation(candidate)) {
      return candidate;
    }
  }
  return "12+34=46" // fallback (should never be reached)
}
```

`tryTemplate(seed)` picks one of ~10 template generators based on `seed % numTemplates`, fills in random operands from remaining seed bits, and returns the formatted string.

### No-leading-zero rule

Any number with more than one digit must not start with `0`. Enforced during template filling.

---

## 4. Validation (`lib/equation.ts`)

Validation is entirely client-side (synchronous). No server API call. Two layers:

### Layer 1: Syntax

Checked in order; first failure shakes the row and shows a toast:

| Rule | Toast message |
|------|---------------|
| Exactly 8 characters | "Not enough letters" / "Too many letters" |
| Only valid characters | "Invalid character" |
| Exactly one `=` | "Must contain exactly one =" |
| `(` count equals `)` count | "Mismatched parentheses" |
| `²` only after a digit or `)` | "Invalid use of ²" |
| No leading zeros on numbers | "No leading zeros" |

### Layer 2: Math

Split on `=` → evaluate `lhs` and `rhs` using a recursive descent parser.

```
equation  → expr "=" expr
expr      → term (("+"|"−") term)*
term      → factor (("×"|"÷") factor)*
factor    → unary ("²")?
unary     → "−"? primary
primary   → number | "(" expr ")"
number    → digit+
```

If `lhs ≠ rhs`: toast "Not a valid equation", shake row.

### Negation (unary `−`)

The parser automatically treats `−` as unary negation when it appears:
- At the start of an expression
- Immediately after `(`
- Immediately after another operator

No special keyboard handling needed — the same `−` key serves both roles.

---

## 5. `useEquationState` Hook

Located at `hooks/useEquationState.ts`. Mirrors `useGameState` with these differences:

| Aspect | Word mode (`useGameState`) | Equation mode (`useEquationState`) |
|--------|---------------------------|-------------------------------------|
| Answer | `getDailyAnswer(wordLength)` | `generateDailyEquation(dayNumber)` |
| Guess validation | Async server call (`isValidWord`) | Sync `isValidEquation()` — no `isValidating` state |
| Accepted input chars | `/[a-zA-Z]/` | `/[0-9+\-×÷=²()]/` |
| Guess length | `wordLength` | `8` |
| Storage key | `hexordle-state-{n}` | `hexordle-state-eq` |
| Server `wordLength` field | 5 / 6 / 7 | `0` |
| Max guesses | 6 | 6 |

The `keyboardColors` map uses the same `TileState` priority logic as word mode, keyed by character.

`evaluateGuess` from `lib/evaluate.ts` is reused as-is — it operates on any string.

---

## 6. `NumericKeyboard` Component

Located at `components/NumericKeyboard.tsx`.

### Layout

```
[ 1 ][ 2 ][ 3 ]  [ + ][ − ]
[ 4 ][ 5 ][ 6 ]  [ × ][ ÷ ]
[ 7 ][ 8 ][ 9 ]  [ = ][ ² ]
[ 0 ][ ( ][ ) ]  [   ⌫   ]
[         ENTER          ]
```

### Props

```typescript
interface NumericKeyboardProps {
  keyboardColors: Map<string, TileState>;
  onKey: (key: string) => void;
}
```

No `isValidating` prop (validation is synchronous).

Each key has `data-state` for color feedback. `(` and `)` are tracked independently in `keyboardColors`.

### Layout note

The keyboard layout (row structure, key sizes) is intentionally isolated in `NumericKeyboard.tsx` so it can be resized independently of the word keyboard as the board layout evolves.

---

## 7. `Game.tsx` Integration

### Mode state

```typescript
const [mode, setMode] = useState<GameMode>(6);
```

### Pre-loading

```typescript
const [stateEq, actionsEq] = useEquationState(
  auth.user.id, guildId, username, auth.user.avatar, today
);
```

All four modes pre-load on mount. Switching tabs is a pure view change with no async transitions.

### Tab rendering

```typescript
{([5, 6, 7, "eq"] as const).map((m) => (
  <button
    key={m}
    className={`mode-tab${mode === m ? " mode-tab--active" : ""}`}
    onClick={() => setMode(m)}
    aria-label={m === "eq" ? "Equation mode" : `${m}-letter mode`}
  >
    {m === "eq" ? "=" : m}
  </button>
))}
```

### Active state routing

```typescript
const activeState   = mode === "eq" ? stateEq   : mode === 5 ? state5   : mode === 7 ? state7   : state6;
const activeActions = mode === "eq" ? actionsEq : mode === 5 ? actions5 : mode === 7 ? actions7 : actions6;
```

### Board passthrough

```typescript
<Board
  wordLength={mode === "eq" ? 8 : mode}
  // ... other props unchanged
/>
```

### Keyboard routing

```typescript
{mode === "eq"
  ? <NumericKeyboard keyboardColors={activeState.keyboardColors} onKey={activeActions.onKey} />
  : <Keyboard keyboardColors={activeState.keyboardColors} onKey={activeActions.onKey} isValidating={activeState.isValidating} />
}
```

---

## 8. Stats

`useStats` already accepts a `wordLength` parameter for its localStorage key. Pass `0` for equation mode:

```typescript
const { stats: statsEq, recordGame: recordGameEq } = useStats(0);
```

---

## 9. Server API

Minimal change: equation mode passes `wordLength: 0` in all existing API calls (`/api/progress`, `/api/guild-progress`). The server stores and returns it as-is. No schema change required.

`/api/validate` is not called for equation mode.

---

## 10. Files Summary

| File | Action | Notes |
|------|--------|-------|
| `lib/equation.ts` | Create | Generator + validator + parser |
| `hooks/useEquationState.ts` | Create | Game state for equation mode |
| `components/NumericKeyboard.tsx` | Create | Nine-key numpad layout |
| `components/Game.tsx` | Modify | Add "eq" tab, pre-load equation state, route keyboard |
| `hooks/useStats.ts` | Modify | Accept `0` as equation mode key (likely already works) |
| `lib/words.ts` | No change | |
| `lib/evaluate.ts` | No change | |
| `components/Board.tsx` | No change | |
| `components/Tile.tsx` | No change | |
| `components/ResultModal.tsx` | No change | |
