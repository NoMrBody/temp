const FN: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
};
const FN_NAMES = Object.keys(FN).sort((a, b) => b.length - a.length);

type F = (x: number) => number;
type Tok = { k: string; v?: number | string };

/* "2x^2 + 1" -> function of x. Implicit multiplication supported. Throws if it can't. No eval. */
export function compileExpr(src: string): F {
  const t = String(src)
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π/g, "pi")
    .replace(/\*\*/g, "^")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\s+/g, "")
    .replace(/^(y|f\(x\)|f)=/, "");
  if (!t || t.length > 120) throw new Error("bad expression");
  const toks: Tok[] = [];
  for (let i = 0; i < t.length; ) {
    const rest = t.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) {
      toks.push({ k: "num", v: parseFloat(m[1]) });
      i += m[1].length;
    } else if ((m = /^[a-z]+/.exec(rest))) {
      let name = m[0];
      i += name.length;
      while (name) {
        const fn = FN_NAMES.find((f) => name.startsWith(f));
        if (fn) {
          toks.push({ k: "fn", v: fn });
          name = name.slice(fn.length);
        } else if (name.startsWith("pi")) {
          toks.push({ k: "num", v: Math.PI });
          name = name.slice(2);
        } else if (name[0] === "x") {
          toks.push({ k: "x" });
          name = name.slice(1);
        } else if (name[0] === "e") {
          toks.push({ k: "num", v: Math.E });
          name = name.slice(1);
        } else throw new Error("unknown name");
      }
    } else if ("+-*/^()".includes(rest[0])) {
      toks.push({ k: rest[0] });
      i++;
    } else throw new Error("bad character");
  }
  let p = 0;
  const peek = () => toks[p];
  const startsPrimary = (k: string) => k === "num" || k === "x" || k === "fn" || k === "(";
  function expr(): F {
    let l = term();
    while (peek() && (peek().k === "+" || peek().k === "-")) {
      const op = toks[p++].k,
        r = term(),
        a = l;
      l = op === "+" ? (x) => a(x) + r(x) : (x) => a(x) - r(x);
    }
    return l;
  }
  function term(): F {
    let l = unary();
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.k === "*" || tk.k === "/") {
        p++;
        const r = unary(),
          a = l;
        l = tk.k === "*" ? (x) => a(x) * r(x) : (x) => a(x) / r(x);
      } else if (startsPrimary(tk.k)) {
        const r = unary(),
          a = l;
        l = (x) => a(x) * r(x);
      } else break;
    }
    return l;
  }
  function unary(): F {
    const tk = peek();
    if (tk && tk.k === "-") {
      p++;
      const u = unary();
      return (x) => -u(x);
    }
    if (tk && tk.k === "+") {
      p++;
      return unary();
    }
    return power();
  }
  function power(): F {
    const b = primary();
    if (peek() && peek().k === "^") {
      p++;
      const e = unary();
      return (x) => Math.pow(b(x), e(x));
    }
    return b;
  }
  function primary(): F {
    const tk = toks[p++];
    if (!tk) throw new Error("unexpected end");
    if (tk.k === "num") {
      const v = tk.v as number;
      return () => v;
    }
    if (tk.k === "x") return (x) => x;
    if (tk.k === "fn") {
      const f = FN[tk.v as string];
      const a = peek() && peek().k === "(" ? primary() : power();
      return (x) => f(a(x));
    }
    if (tk.k === "(") {
      const e = expr();
      if (!peek() || peek().k !== ")") throw new Error("missing )");
      p++;
      return e;
    }
    throw new Error("unexpected " + tk.k);
  }
  const f = expr();
  if (p !== toks.length) throw new Error("unexpected input");
  let finite = 0;
  for (let i = -12; i <= 12; i++) {
    const y = f(i / 2 + 0.013);
    if (Number.isFinite(y)) finite++;
  }
  if (!finite) throw new Error("nothing to plot");
  return f;
}

export interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export interface Series {
  expr: string;
  label: string;
  f: F;
  color: string;
}

export function fitView(series: { f: F }[]): View {
  const x0 = -6,
    x1 = 6,
    ys: number[] = [];
  for (const sr of series) {
    for (let i = 0; i <= 240; i++) {
      const y = sr.f(x0 + ((x1 - x0) * i) / 240);
      if (Number.isFinite(y) && Math.abs(y) < 1e9) ys.push(y);
    }
  }
  let lo = -6,
    hi = 6;
  if (ys.length) {
    ys.sort((a, b) => a - b);
    lo = ys[Math.floor(ys.length * 0.03)];
    hi = ys[Math.ceil(ys.length * 0.97) - 1];
    if (hi - lo < 2) {
      const m = (hi + lo) / 2;
      lo = m - 1;
      hi = m + 1;
    }
    const span = hi - lo;
    if (!(lo > span * 2 || hi < -span * 2)) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
  }
  return { x0, x1, y0: lo, y1: hi };
}

export function pointsOfInterest(sr: { f: F }, v: View): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const N = 500,
    dx = (v.x1 - v.x0) / N;
  const xs: number[] = [],
    ys: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = v.x0 + i * dx;
    xs.push(x);
    ys.push(sr.f(x));
  }
  const ok = (y: number) => Number.isFinite(y) && Math.abs(y) < 1e9;
  const scale = Math.max(1e-9, v.y1 - v.y0);
  if (v.x0 < 0 && v.x1 > 0) {
    const y = sr.f(0);
    if (ok(y) && y >= v.y0 && y <= v.y1) out.push({ x: 0, y });
  }
  for (let i = 0; i < N; i++) {
    const a = ys[i],
      b = ys[i + 1];
    if (!ok(a) || !ok(b) || a === 0 || a * b > 0 || Math.abs(b - a) > scale * 0.5) continue;
    let lo = xs[i],
      hi = xs[i + 1];
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (sr.f(lo) * sr.f(mid) <= 0) hi = mid;
      else lo = mid;
    }
    const rx = (lo + hi) / 2;
    if (Math.abs(sr.f(rx)) < scale * 1e-3) out.push({ x: rx, y: 0 });
  }
  for (let i = 1; i < N; i++) {
    const a = ys[i - 1],
      b = ys[i],
      c = ys[i + 1];
    if (![a, b, c].every(ok)) continue;
    const isMax = b > a && b >= c,
      isMin = b < a && b <= c;
    if (!isMax && !isMin) continue;
    if (Math.max(Math.abs(b - a), Math.abs(b - c)) < scale * 1e-5) continue;
    let lo = xs[i - 1],
      hi = xs[i + 1];
    const g = isMax ? (x: number) => -sr.f(x) : (x: number) => sr.f(x);
    for (let k = 0; k < 40; k++) {
      const m1 = lo + (hi - lo) / 3,
        m2 = hi - (hi - lo) / 3;
      if (g(m1) < g(m2)) hi = m2;
      else lo = m1;
    }
    const ex = (lo + hi) / 2,
      ey = sr.f(ex);
    if (ok(ey) && ey >= v.y0 && ey <= v.y1) out.push({ x: ex, y: ey });
  }
  const keep: { x: number; y: number }[] = [];
  for (const p of out)
    if (!keep.some((q) => Math.abs(q.x - p.x) < (v.x1 - v.x0) * 0.02 && Math.abs(q.y - p.y) < scale * 0.02)) keep.push(p);
  return keep.slice(0, 6);
}
