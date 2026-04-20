# Number Mode (Equation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth "Equation" game mode to Hexordle where players guess a hidden 8-character math equation each day using Wordle-style color feedback.

**Architecture:** A new `GameMode = 5 | 6 | 7 | "eq"` type discriminates between word and equation modes. Three new files handle equation logic (`lib/equation.ts`), game state (`hooks/useEquationState.ts`), and keyboard UI (`components/NumericKeyboard.tsx`). `Game.tsx` is extended to pre-load the equation state and route to new components when `mode === "eq"`. Two existing files (`lib/share.ts`, `components/ResultModal.tsx`) get minor text updates.

**Tech Stack:** React 18, TypeScript 5, Vite. No new dependencies. No test runner installed — verification via `npx tsc --noEmit` and browser console.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/client/src/lib/equation.ts` | Create | LCG, 10 template generators, daily equation generator, syntax validator, recursive descent math parser |
| `packages/client/src/hooks/useEquationState.ts` | Create | Game state hook for equation mode (mirrors useGameState) |
| `packages/client/src/components/NumericKeyboard.tsx` | Create | Nine-key numpad keyboard component |
| `packages/client/src/lib/share.ts` | Modify | Handle `wordLength === 0` → show "Eq" in share header |
| `packages/client/src/components/ResultModal.tsx` | Modify | Show "The equation was X" when `wordLength === 0` |
| `packages/client/src/components/Game.tsx` | Modify | Add `GameMode` type, eq tab, eq state/stats/guild pre-load, keyboard routing |

---

### Task 1: Core Equation Logic (`lib/equation.ts`)

**Files:**
- Create: `packages/client/src/lib/equation.ts`

- [ ] **Step 1: Create `lib/equation.ts` with all logic**

Create `packages/client/src/lib/equation.ts` with the following content in full:

```typescript
import { getDayNumber } from "./share";

// ─── LCG (same constants as words.ts) ─────────────────────────────────────
function lcg(s: number): number {
  return (Math.imul(s, 1664525) + 1013904223) >>> 0;
}

// ─── Unicode operator constants ────────────────────────────────────────────
export const MINUS  = "\u2212"; // − (MINUS SIGN)
export const TIMES  = "\u00D7"; // × (MULTIPLICATION SIGN)
export const DIVID  = "\u00F7"; // ÷ (DIVISION SIGN)
export const SUPER2 = "\u00B2"; // ² (SUPERSCRIPT TWO)

// ─── Template generators ───────────────────────────────────────────────────
// Each takes a seed and returns an 8-char equation string or null.
// All generated equations have no leading zeros and are mathematically valid.

// dd+dd=dd  e.g. 12+34=46
function t1(seed: number): string | null {
  let s = lcg(seed);
  const a = 10 + (s % 45); s = lcg(s);   // 10–54 so a+b ≤ 99 is reachable
  const bMax = Math.min(89, 99 - a);
  if (bMax < 10) return null;
  const b = 10 + (s % (bMax - 9));
  const c = a + b;
  if (c < 10 || c > 99) return null;
  const eq = `${a}+${b}=${c}`;
  return eq.length === 8 ? eq : null;
}

// dd−dd=dd  e.g. 45−12=33
function t2(seed: number): string | null {
  let s = lcg(seed);
  const a = 20 + (s % 80); s = lcg(s);   // 20–99
  const bMax = a - 10;
  if (bMax < 10) return null;
  const b = 10 + (s % (bMax - 9));
  const c = a - b;
  if (c < 10 || c > 99) return null;
  const eq = `${a}${MINUS}${b}=${c}`;
  return eq.length === 8 ? eq : null;
}

// dd×d=ddd  e.g. 25×4=100
function t3(seed: number): string | null {
  let s = lcg(seed);
  const b = 1 + (s % 9); s = lcg(s);     // 1–9
  const aMin = Math.ceil(100 / b);
  const aMax = Math.floor(999 / b);
  const lo = Math.max(aMin, 10), hi = Math.min(aMax, 99);
  if (lo > hi) return null;
  const a = lo + (s % (hi - lo + 1));
  const c = a * b;
  if (c < 100 || c > 999) return null;
  const eq = `${a}${TIMES}${b}=${c}`;
  return eq.length === 8 ? eq : null;
}

// ddd÷d=dd  e.g. 120÷6=20
function t4(seed: number): string | null {
  let s = lcg(seed);
  const c = 10 + (s % 90); s = lcg(s);   // quotient 10–99
  const b = 1 + (s % 9);                 // divisor 1–9
  const a = c * b;
  if (a < 100 || a > 999) return null;
  const eq = `${a}${DIVID}${b}=${c}`;
  return eq.length === 8 ? eq : null;
}

// d²+dd=dd  e.g. 2²+11=15
function t5(seed: number): string | null {
  let s = lcg(seed);
  const a = 2 + (s % 8); s = lcg(s);     // base 2–9
  const sq = a * a;
  const bMin = 10, bMax = 99 - sq;
  if (bMax < bMin) return null;
  const b = bMin + (s % (bMax - bMin + 1));
  const c = sq + b;
  if (c < 10 || c > 99) return null;
  const eq = `${a}${SUPER2}+${b}=${c}`;
  return eq.length === 8 ? eq : null;
}

// dd−d²=dd  e.g. 19−3²=10
function t6(seed: number): string | null {
  let s = lcg(seed);
  const b = 2 + (s % 8); s = lcg(s);     // base 2–9
  const sq = b * b;
  const cMin = 10, cMax = 99 - sq;
  if (cMax < cMin) return null;
  const c = cMin + (s % (cMax - cMin + 1));
  const a = c + sq;
  if (a < 10 || a > 99) return null;
  const eq = `${a}${MINUS}${b}${SUPER2}=${c}`;
  return eq.length === 8 ? eq : null;
}

// (d+d)=dd  e.g. (5+6)=11
function t7(seed: number): string | null {
  let s = lcg(seed);
  const a = 1 + (s % 9); s = lcg(s);
  const bMin = Math.max(1, 10 - a), bMax = 9;
  if (bMin > bMax) return null;
  const b = bMin + (s % (bMax - bMin + 1));
  const c = a + b;
  if (c < 10 || c > 18) return null;
  const eq = `(${a}+${b})=${c}`;
  return eq.length === 8 ? eq : null;
}

// (d×d)=dd  e.g. (3×5)=15
function t8(seed: number): string | null {
  let s = lcg(seed);
  const a = 2 + (s % 8); s = lcg(s);
  const bMin = Math.ceil(10 / a), bMax = Math.min(9, Math.floor(99 / a));
  if (bMin > bMax) return null;
  const b = bMin + (s % (bMax - bMin + 1));
  const c = a * b;
  if (c < 10 || c > 99) return null;
  const eq = `(${a}${TIMES}${b})=${c}`;
  return eq.length === 8 ? eq : null;
}

// d+d+d=dd  e.g. 4+5+6=15
function t9(seed: number): string | null {
  let s = lcg(seed);
  const a = 1 + (s % 9); s = lcg(s);
  const b = 1 + (s % 9); s = lcg(s);
  const dMin = Math.max(1, 10 - a - b), dMax = Math.min(9, 27 - a - b);
  if (dMin > dMax) return null;
  const d = dMin + (s % (dMax - dMin + 1));
  const sum = a + b + d;
  if (sum < 10 || sum > 27) return null;
  const eq = `${a}+${b}+${d}=${sum}`;
  return eq.length === 8 ? eq : null;
}

// dd+d²=dd  e.g. 10+2²=14
function t10(seed: number): string | null {
  let s = lcg(seed);
  const b = 2 + (s % 8); s = lcg(s);
  const sq = b * b;
  const aMin = 10, aMax = 99 - sq;
  if (aMax < aMin) return null;
  const a = aMin + (s % (aMax - aMin + 1));
  const c = a + sq;
  if (c < 10 || c > 99) return null;
  const eq = `${a}+${b}${SUPER2}=${c}`;
  return eq.length === 8 ? eq : null;
}

const TEMPLATES = [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10];

// ─── Daily equation generator ──────────────────────────────────────────────
export function generateDailyEquation(dayNumber: number): string {
  let seed = (dayNumber * 0x9e3779b9) >>> 0;
  for (let attempt = 0; attempt < 200; attempt++) {
    seed = lcg(seed);
    const tFn = TEMPLATES[seed % TEMPLATES.length];
    seed = lcg(seed);
    const result = tFn(seed);
    if (result && result.length === 8) return result;
  }
  return "12+34=46"; // fallback — never reached in practice
}

// ─── Recursive descent parser ──────────────────────────────────────────────
// Grammar:
//   expr    → term (('+' | MINUS) term)*
//   term    → factor ((TIMES | DIVID) factor)*
//   factor  → unary (SUPER2)?
//   unary   → MINUS? primary
//   primary → number | '(' expr ')'
//   number  → digit+

function parseExpr(s: string, pos: { i: number }): number {
  let left = parseTerm(s, pos);
  while (pos.i < s.length && (s[pos.i] === "+" || s[pos.i] === MINUS)) {
    const op = s[pos.i++];
    const right = parseTerm(s, pos);
    left = op === "+" ? left + right : left - right;
  }
  return left;
}

function parseTerm(s: string, pos: { i: number }): number {
  let left = parseFactor(s, pos);
  while (pos.i < s.length && (s[pos.i] === TIMES || s[pos.i] === DIVID)) {
    const op = s[pos.i++];
    const right = parseFactor(s, pos);
    if (op === DIVID) {
      if (right === 0) throw new Error("Division by zero");
      left = left / right;
    } else {
      left = left * right;
    }
  }
  return left;
}

function parseFactor(s: string, pos: { i: number }): number {
  const base = parseUnary(s, pos);
  if (pos.i < s.length && s[pos.i] === SUPER2) {
    pos.i++;
    return base * base;
  }
  return base;
}

function parseUnary(s: string, pos: { i: number }): number {
  if (pos.i < s.length && s[pos.i] === MINUS) {
    pos.i++;
    return -parsePrimary(s, pos);
  }
  return parsePrimary(s, pos);
}

function parsePrimary(s: string, pos: { i: number }): number {
  if (pos.i < s.length && s[pos.i] === "(") {
    pos.i++;
    const val = parseExpr(s, pos);
    if (pos.i >= s.length || s[pos.i] !== ")") throw new Error("Expected )");
    pos.i++;
    return val;
  }
  let numStr = "";
  while (pos.i < s.length && s[pos.i] >= "0" && s[pos.i] <= "9") {
    numStr += s[pos.i++];
  }
  if (!numStr) throw new Error(`Expected number at position ${pos.i}`);
  return parseInt(numStr, 10);
}

function evalSide(expr: string): number {
  const pos = { i: 0 };
  const result = parseExpr(expr, pos);
  if (pos.i !== expr.length) throw new Error(`Unexpected char '${expr[pos.i]}'`);
  return result;
}

// ─── Validator ─────────────────────────────────────────────────────────────
const VALID_CHARS = new Set([..."0123456789+=()", MINUS, TIMES, DIVID, SUPER2]);
const AFTER_SUPER2_OK = new Set([..."0123456789)"]);

export function isValidEquation(eq: string): { valid: true } | { valid: false; reason: string } {
  // Layer 1: syntax
  if (eq.length < 8) return { valid: false, reason: "Not enough characters" };
  if (eq.length > 8) return { valid: false, reason: "Too many characters" };

  for (const ch of eq) {
    if (!VALID_CHARS.has(ch)) return { valid: false, reason: "Invalid character" };
  }

  const eqCount = [...eq].filter((c) => c === "=").length;
  if (eqCount !== 1) return { valid: false, reason: "Must contain exactly one =" };

  const opens  = [...eq].filter((c) => c === "(").length;
  const closes = [...eq].filter((c) => c === ")").length;
  if (opens !== closes) return { valid: false, reason: "Mismatched parentheses" };

  for (let i = 0; i < eq.length; i++) {
    if (eq[i] === SUPER2) {
      if (i === 0 || !AFTER_SUPER2_OK.has(eq[i - 1])) {
        return { valid: false, reason: "Invalid use of \u00B2" };
      }
    }
  }

  // Leading zero: a '0' at the start of a multi-digit number
  for (let i = 0; i < eq.length - 1; i++) {
    if (eq[i] === "0" && eq[i + 1] >= "0" && eq[i + 1] <= "9") {
      const prev = i > 0 ? eq[i - 1] : null;
      if (prev === null || prev < "0" || prev > "9") {
        return { valid: false, reason: "No leading zeros" };
      }
    }
  }

  // Layer 2: math
  const eqIdx = eq.indexOf("=");
  const lhs = eq.slice(0, eqIdx);
  const rhs = eq.slice(eqIdx + 1);

  try {
    const lhsVal = evalSide(lhs);
    const rhsVal = evalSide(rhs);
    if (!Number.isFinite(lhsVal) || !Number.isFinite(rhsVal)) {
      return { valid: false, reason: "Not a valid equation" };
    }
    if (Math.abs(lhsVal - rhsVal) > 1e-9) {
      return { valid: false, reason: "Not a valid equation" };
    }
  } catch {
    return { valid: false, reason: "Not a valid equation" };
  }

  return { valid: true };
}

// ─── Exported helpers for useEquationState ─────────────────────────────────

// All characters a player may type
export const EQUATION_INPUT_CHARS = new Set([
  ..."0123456789+=()",
  MINUS, TIMES, DIVID, SUPER2,
]);

// Map physical keyboard characters to their Unicode equation equivalents
export function normalizeEquationKey(key: string): string {
  if (key === "-") return MINUS;
  if (key === "*") return TIMES;
  if (key === "/") return DIVID;
  return key;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test logic in browser console**

Run the dev server (`npm run dev` from `packages/client`). In DevTools console:

```javascript
const { generateDailyEquation, isValidEquation } = await import('/src/lib/equation.ts');

const eq = generateDailyEquation(110);
console.assert(eq.length === 8, 'length must be 8, got: ' + eq.length);
console.log('Generated equation:', eq);

console.assert(isValidEquation('12+34=46').valid === true,  '12+34=46 valid');
console.assert(isValidEquation('(3\u00D75)=15').valid === true, '(3\u00D75)=15 valid');
console.assert(isValidEquation('2\u00B2+11=15').valid === true, '2\u00B2+11=15 valid');
console.assert(isValidEquation('12+34=47').valid === false, 'wrong math rejected');
console.assert(isValidEquation('12+34=4').valid === false,  'too short rejected');
console.assert(isValidEquation('01+4=056').valid === false, 'leading zero rejected');
console.assert(isValidEquation('(2+3)=56').valid === false, 'mismatched math rejected');
console.assert(isValidEquation('+\u00B2+34=46').valid === false, '\u00B2 after op rejected');

console.log('All assertions passed');
```

Expected: "All assertions passed", no console errors.

- [ ] **Step 4: Commit**

```bash
cd packages/client
git add src/lib/equation.ts
git commit -m "feat: add equation generator, validator, and recursive descent parser"
```

---

### Task 2: Equation State Hook (`hooks/useEquationState.ts`)

**Files:**
- Create: `packages/client/src/hooks/useEquationState.ts`

- [ ] **Step 1: Create the hook**

Create `packages/client/src/hooks/useEquationState.ts`:

```typescript
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { TileState, evaluateGuess } from "../lib/evaluate";
import { getDayNumber } from "../lib/share";
import {
  generateDailyEquation,
  isValidEquation,
  EQUATION_INPUT_CHARS,
  normalizeEquationKey,
} from "../lib/equation";
import { GameStatus } from "./useGameState";

const WORD_LENGTH = 8;
const MAX_GUESSES = 6;

interface SavedEquationState {
  guesses: string[];
  evaluations: TileState[][];
  gameStatus: GameStatus;
  dayNumber: number;
}

function loadSaved(): SavedEquationState | null {
  try {
    const raw = localStorage.getItem("hexordle-state-eq");
    if (!raw) return null;
    const saved: SavedEquationState = JSON.parse(raw);
    if (saved.dayNumber !== getDayNumber()) return null;
    return saved;
  } catch {
    return null;
  }
}

function persist(state: SavedEquationState) {
  try {
    localStorage.setItem("hexordle-state-eq", JSON.stringify(state));
  } catch {}
}

async function fetchServer(userId: string, today: string): Promise<SavedEquationState | null> {
  try {
    const res = await fetch(
      `/.proxy/api/progress?userId=${encodeURIComponent(userId)}&date=${today}&wordLength=0`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data) return null;
    return {
      guesses: data.guesses ?? [],
      evaluations: data.evaluations ?? [],
      gameStatus: data.completed ? (data.won ? "won" : "lost") : "playing",
      dayNumber: getDayNumber(),
    };
  } catch {
    return null;
  }
}

function pushServer(
  userId: string,
  state: SavedEquationState,
  today: string,
  guildId?: string,
  username?: string,
  avatarHash?: string | null
) {
  fetch("/.proxy/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      date: today,
      dayNumber: state.dayNumber,
      guesses: state.guesses,
      evaluations: state.evaluations,
      completed: state.gameStatus !== "playing",
      won: state.gameStatus === "won",
      guildId,
      username,
      avatarHash,
      wordLength: 0,
    }),
  }).catch(() => {});
}

function deriveKeyboardColors(
  guesses: string[],
  evaluations: TileState[][]
): Map<string, TileState> {
  const priority: Record<TileState, number> = { absent: 1, present: 2, correct: 3 };
  const map = new Map<string, TileState>();
  guesses.forEach((guess, gi) => {
    [...guess].forEach((ch, ci) => {
      const current = map.get(ch);
      const next = evaluations[gi][ci];
      if (!current || priority[next] > priority[current]) map.set(ch, next);
    });
  });
  return map;
}

export interface EquationState {
  answer: string;
  dayNumber: number;
  guesses: string[];
  evaluations: TileState[][];
  currentGuess: string;
  gameStatus: GameStatus;
  shakeRow: boolean;
  revealRow: number | null;
  pendingGuess: string;
  pendingEvaluation: TileState[] | undefined;
  toast: string | null;
  keyboardColors: Map<string, TileState>;
  isValidating: false; // always false — validation is synchronous
}

export interface EquationActions {
  onKey: (key: string) => void;
}

export function useEquationState(
  userId?: string,
  guildId?: string,
  username?: string,
  avatarHash?: string | null,
  today = ""
): [EquationState, EquationActions] {
  const dayNumber = useMemo(() => getDayNumber(), [today]); // eslint-disable-line
  const answer    = useMemo(() => generateDailyEquation(dayNumber), [dayNumber]);

  const saved = loadSaved();
  const [guesses,    setGuesses]    = useState<string[]>(saved?.guesses ?? []);
  const [evaluations, setEvaluations] = useState<TileState[][]>(saved?.evaluations ?? []);
  const [currentGuess, setCurrentGuess] = useState("");
  const [gameStatus,   setGameStatus]   = useState<GameStatus>(saved?.gameStatus ?? "playing");
  const [shakeRow,  setShakeRow]  = useState(false);
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [pendingGuess,      setPendingGuess]      = useState("");
  const [pendingEvaluation, setPendingEvaluation] = useState<TileState[] | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const prevTodayRef = useRef(today);

  // Reset state on date change (midnight rollover)
  useEffect(() => {
    if (prevTodayRef.current === today) return;
    prevTodayRef.current = today;
    const s = loadSaved();
    setGuesses(s?.guesses ?? []);
    setEvaluations(s?.evaluations ?? []);
    setGameStatus(s?.gameStatus ?? "playing");
    setCurrentGuess("");
    setShakeRow(false);
    setRevealRow(null);
    setPendingGuess("");
    setPendingEvaluation(undefined);
    setToast(null);
  }, [today]);

  // Load server progress on mount / date change
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchServer(userId, today).then((srv) => {
      if (cancelled || !srv) return;
      setGuesses((prev) => {
        if (srv.gameStatus !== "playing" || srv.guesses.length > prev.length) {
          setEvaluations(srv.evaluations);
          setGameStatus(srv.gameStatus);
          persist(srv);
          return srv.guesses;
        }
        return prev;
      });
    });
    return () => { cancelled = true; };
  }, [userId, today]); // eslint-disable-line

  const showToast = useCallback((msg: string, dur = 1500) => {
    setToast(msg);
    setTimeout(() => setToast(null), dur);
  }, []);

  const submitGuess = useCallback(
    (guess: string) => {
      const evaluation = evaluateGuess(guess, answer);
      const newGuesses     = [...guesses, guess];
      const newEvaluations = [...evaluations, evaluation];
      const rowIndex = guesses.length;

      setPendingGuess(guess);
      setPendingEvaluation(evaluation);
      setRevealRow(rowIndex);
      setCurrentGuess("");

      setTimeout(() => {
        setRevealRow(null);
        setPendingGuess("");
        setPendingEvaluation(undefined);
        setGuesses(newGuesses);
        setEvaluations(newEvaluations);

        const won  = evaluation.every((s) => s === "correct");
        const lost = !won && newGuesses.length >= MAX_GUESSES;
        const newStatus: GameStatus = won ? "won" : lost ? "lost" : "playing";
        setGameStatus(newStatus);

        const stateToSave = { guesses: newGuesses, evaluations: newEvaluations, gameStatus: newStatus, dayNumber };
        persist(stateToSave);
        if (userId) pushServer(userId, stateToSave, today, guildId, username, avatarHash);

        if (won) {
          const msgs = ["Brilliant!", "Impressive!", "Splendid!", "Great!", "Phew!", "Close one!"];
          showToast(msgs[Math.min(newGuesses.length - 1, 5)], 2500);
        } else if (lost) {
          showToast(answer, 3000);
        }
      }, WORD_LENGTH * 150 + 500);
    },
    [guesses, evaluations, answer, dayNumber, today, showToast] // eslint-disable-line
  );

  const onKey = useCallback(
    (key: string) => {
      if (gameStatus !== "playing") return;
      if (revealRow !== null) return;

      const k = normalizeEquationKey(key);

      if (k === "Backspace") {
        setCurrentGuess((g) => g.slice(0, -1));
        return;
      }

      if (k === "Enter") {
        if (currentGuess.length < WORD_LENGTH) {
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

      if (EQUATION_INPUT_CHARS.has(k) && currentGuess.length < WORD_LENGTH) {
        setCurrentGuess((g) => g + k);
      }
    },
    [gameStatus, revealRow, currentGuess, showToast, submitGuess]
  );

  const keyboardColors = deriveKeyboardColors(guesses, evaluations);

  return [
    {
      answer, dayNumber, guesses, evaluations, currentGuess,
      gameStatus, shakeRow, revealRow, pendingGuess, pendingEvaluation,
      toast, keyboardColors, isValidating: false,
    },
    { onKey },
  ];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useEquationState.ts
git commit -m "feat: add useEquationState hook for equation game mode"
```

---

### Task 3: Numeric Keyboard (`components/NumericKeyboard.tsx`)

**Files:**
- Create: `packages/client/src/components/NumericKeyboard.tsx`

- [ ] **Step 1: Create the component**

Create `packages/client/src/components/NumericKeyboard.tsx`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/NumericKeyboard.tsx
git commit -m "feat: add NumericKeyboard component with nine-key numpad layout"
```

---

### Task 4: Share Text and Result Modal Updates

**Files:**
- Modify: `packages/client/src/lib/share.ts`
- Modify: `packages/client/src/components/ResultModal.tsx`

- [ ] **Step 1: Update `generateShareText` in `lib/share.ts`**

In `packages/client/src/lib/share.ts`, find:

```typescript
const header = `Hexordle #${day} (${wordLength}L) ${score}/6`;
```

Replace with:

```typescript
const modeLabel = wordLength === 0 ? "Eq" : `${wordLength}L`;
const header = `Hexordle #${day} (${modeLabel}) ${score}/6`;
```

- [ ] **Step 2: Update lost-game answer text in `ResultModal.tsx`**

In `packages/client/src/components/ResultModal.tsx`, find:

```typescript
{gameStatus === "lost" && (
  <p className="modal-answer">
    The word was <strong>{answer.toUpperCase()}</strong>
  </p>
)}
```

Replace with:

```typescript
{gameStatus === "lost" && (
  <p className="modal-answer">
    {wordLength === 0 ? "The equation was" : "The word was"}{" "}
    <strong>{answer.toUpperCase()}</strong>
  </p>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/lib/share.ts packages/client/src/components/ResultModal.tsx
git commit -m "feat: show 'Eq' label and 'equation' text for equation game mode"
```

---

### Task 5: Game.tsx Integration

**Files:**
- Modify: `packages/client/src/components/Game.tsx`

- [ ] **Step 1: Add imports**

At the top of `Game.tsx`, after the existing import block, add:

```typescript
import { useEquationState } from "../hooks/useEquationState";
import { NumericKeyboard } from "./NumericKeyboard";
```

- [ ] **Step 2: Add `GameMode` type and update mode state**

After the `GameProps` interface definition, add:

```typescript
type GameMode = 5 | 6 | 7 | "eq";
```

Find:

```typescript
const [wordLength, setWordLength] = useState<5 | 6 | 7>(6);
```

Replace with:

```typescript
const [mode, setMode] = useState<GameMode>(6);
```

- [ ] **Step 3: Pre-load equation state**

After the three existing `useGameState` calls (`state5`/`state6`/`state7`), add:

```typescript
const [stateEq, actionsEq] = useEquationState(auth.user.id, guildId, username, auth.user.avatar, today);
```

- [ ] **Step 4: Update active state and actions**

Find:

```typescript
const activeState   = wordLength === 5 ? state5   : wordLength === 7 ? state7   : state6;
const activeActions = wordLength === 5 ? actions5 : wordLength === 7 ? actions7 : actions6;
```

Replace with:

```typescript
const activeState   = mode === "eq" ? stateEq   : mode === 5 ? state5   : mode === 7 ? state7   : state6;
const activeActions = mode === "eq" ? actionsEq : mode === 5 ? actions5 : mode === 7 ? actions7 : actions6;
```

- [ ] **Step 5: Add equation stats**

After the three existing `useStats` calls, add:

```typescript
const { stats: statsEq, recordGame: recordGameEq } = useStats(0);
```

Find:

```typescript
const activeStats = wordLength === 5 ? stats5 : wordLength === 7 ? stats7 : stats6;
```

Replace with:

```typescript
const activeStats = mode === "eq" ? statsEq : mode === 5 ? stats5 : mode === 7 ? stats7 : stats6;
```

- [ ] **Step 6: Add equation guild records**

After the three `guildRecords` state declarations (`guildRecords5`/`6`/`7`), add:

```typescript
const [guildRecordsEq, setGuildRecordsEq] = useState<GuildRecord[]>([]);
```

Find:

```typescript
const activeGuildRecords = wordLength === 5 ? guildRecords5 : wordLength === 7 ? guildRecords7 : guildRecords6;
```

Replace with:

```typescript
const activeGuildRecords = mode === "eq" ? guildRecordsEq : mode === 5 ? guildRecords5 : mode === 7 ? guildRecords7 : guildRecords6;
```

Add a guild fetch effect for equation mode, after the three existing guild fetch `useEffect` blocks:

```typescript
useEffect(() => {
  if (!guildId) return;
  const fetch_ = () =>
    fetch(`/.proxy/api/guild-progress?guildId=${guildId}&date=${today}&wordLength=0`)
      .then((r) => r.json()).then(setGuildRecordsEq).catch(() => {});
  fetch_();
  const id = setInterval(fetch_, 30_000);
  return () => clearInterval(id);
}, [guildId, today]);
```

- [ ] **Step 7: Add equation stats recording effect**

After the three existing stats-recording `useEffect` blocks, add:

```typescript
useEffect(() => {
  if (stateEq.gameStatus !== "playing") recordGameEq(stateEq.gameStatus, stateEq.guesses.length, stateEq.dayNumber);
}, [stateEq.gameStatus]); // eslint-disable-line
```

- [ ] **Step 8: Fix `wordLength` → `mode` references in effects**

Find:

```typescript
useEffect(() => {
  setShowResult(false);
}, [wordLength]);
```

Replace with:

```typescript
useEffect(() => {
  setShowResult(false);
}, [mode]);
```

Find:

```typescript
const key = `${wordLength}:${activeState.gameStatus}`;
```

Replace with:

```typescript
const key = `${mode}:${activeState.gameStatus}`;
```

Find (the mode-switch multiplayer ref and effect):

```typescript
const prevWordLengthRef = useRef(wordLength);
useEffect(() => {
  if (prevWordLengthRef.current !== wordLength) {
    prevWordLengthRef.current = wordLength;
    sendProgress(activeState.evaluations, wordLength);
  }
}, [wordLength]); // eslint-disable-line
```

Replace with:

```typescript
const prevModeRef = useRef<GameMode>(mode);
useEffect(() => {
  if (prevModeRef.current !== mode) {
    prevModeRef.current = mode;
    sendProgress(activeState.evaluations, mode === "eq" ? 0 : mode);
  }
}, [mode]); // eslint-disable-line
```

Find (the guess-count multiplayer effect — `sendProgress` line inside it):

```typescript
sendProgress(activeState.evaluations, wordLength);
```

Replace with:

```typescript
sendProgress(activeState.evaluations, mode === "eq" ? 0 : mode);
```

- [ ] **Step 9: Update mode tabs in JSX**

Find:

```typescript
{([5, 6, 7] as const).map((n) => (
  <button
    key={n}
    className={`mode-tab${wordLength === n ? " mode-tab--active" : ""}`}
    onClick={() => setWordLength(n)}
    aria-label={`${n}-letter mode`}
  >
    {n}
  </button>
))}
```

Replace with:

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

- [ ] **Step 10: Update Board `wordLength` prop**

Find `wordLength={wordLength}` in the `<Board` JSX and replace with:

```typescript
wordLength={mode === "eq" ? 8 : mode}
```

- [ ] **Step 11: Replace `<Keyboard>` with conditional keyboard routing**

Find:

```typescript
<Keyboard
  keyboardColors={activeState.keyboardColors}
  onKey={activeActions.onKey}
  isValidating={activeState.isValidating}
/>
```

Replace with:

```typescript
{mode === "eq" ? (
  <NumericKeyboard
    keyboardColors={activeState.keyboardColors}
    onKey={activeActions.onKey}
  />
) : (
  <Keyboard
    keyboardColors={activeState.keyboardColors}
    onKey={activeActions.onKey}
    isValidating={activeState.isValidating}
  />
)}
```

- [ ] **Step 12: Update `<ResultModal>` `wordLength` prop**

Find `wordLength={wordLength}` in the `<ResultModal` JSX and replace with:

```typescript
wordLength={mode === "eq" ? 0 : mode}
```

- [ ] **Step 13: Verify TypeScript compiles**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors. Fix any remaining `wordLength` references that TypeScript flags.

- [ ] **Step 14: Manual browser smoke test**

Start dev server:

```bash
cd packages/client && npm run dev
```

Check each of the following:

1. Four tabs visible: `5` `6` `7` `=`
2. Clicking `=` shows the numeric keyboard (rows: `1 2 3 + −`, `4 5 6 × ÷`, `7 8 9 = ²`, `0 ( ) ⌫`, `ENTER`)
3. Typing digits and operators fills the tile row
4. Pressing `Backspace` removes the last character
5. Pressing `Enter` with fewer than 8 characters shows "Not enough characters" and shakes the row
6. Typing `99+99=99` (mathematically false) and pressing Enter shows "Not a valid equation"
7. Typing `+²+34=46` and pressing Enter shows "Invalid use of ²"
8. Typing the day's actual equation (from console: `generateDailyEquation(getDayNumber())`) results in all green tiles and a "Brilliant!" / win toast
9. Switching back to `6` restores the word keyboard and word board

- [ ] **Step 15: Commit**

```bash
git add packages/client/src/components/Game.tsx
git commit -m "feat: integrate equation mode as fourth game tab"
```
