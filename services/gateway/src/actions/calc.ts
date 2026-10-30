/**
 * A small, safe calculator (no eval): + - * / % ^, parentheses, unary minus, constants and common functions.
 * Local models are bad at arithmetic, so ULTRON hands exact maths to this instead of guessing.
 */
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

export function calculate(expression: string): number {
  const src = expression.replace(/×/g, "*").replace(/÷/g, "/").replace(/,(?=\d{3}\b)/g, "").replace(/\*\*/g, "^");
  if (src.length > 300) throw new Error("That expression is too long.");
  let i = 0;
  const peek = () => { while (src[i] === " ") i++; return src[i]; };
  const eat = (c: string) => { if (peek() === c) { i++; return true; } return false; };

  function primary(): number {
    const c = peek();
    if (c === "(") {
      i++;
      const v = expr();
      if (!eat(")")) throw new Error("Missing closing parenthesis.");
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    const id = /^[a-z][a-z0-9]*/i.exec(src.slice(i));
    if (id) {
      const name = id[0].toLowerCase();
      i += id[0].length;
      if (name in CONSTS) return CONSTS[name]!;
      const f = FUNCS[name];
      if (!f) throw new Error(`Unknown name "${id[0]}".`);
      if (peek() !== "(") throw new Error(`${name} needs parentheses, like ${name}(2).`);
      return f(primary());
    }
    throw new Error(c === undefined ? "The expression ended unexpectedly." : `Unexpected "${c}".`);
  }
  function postfix(): number {
    let v = primary();
    while (peek() === "%" ) {
      // "%" directly after a number means percent (50% → 0.5); "a % b" with a following operand is modulo.
      const save = i;
      i++;
      const next = peek();
      if (next !== undefined && /[\d.(a-z]/i.test(next)) { i = save; break; }
      v = v / 100;
    }
    return v;
  }
  function unary(): number {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    return power();
  }
  function power(): number {
    const base = postfix();
    if (eat("^")) return base ** unary(); // right-associative, binds tighter than unary minus on the left
    return base;
  }
  function term(): number {
    let v = unary();
    for (;;) {
      if (eat("*")) v *= unary();
      else if (eat("/")) v /= unary();
      else if (peek() === "%") { i++; v %= unary(); }
      else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  }
  const v = expr();
  if (peek() !== undefined) throw new Error(`Unexpected "${peek()}".`);
  if (!Number.isFinite(v)) throw new Error("The result isn't a finite number (division by zero?).");
  return v;
}

/** Rounds away floating-point noise (0.1+0.2 → 0.3) without hiding real precision. */
export const tidy = (v: number) => Number(v.toPrecision(12));
