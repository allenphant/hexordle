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
