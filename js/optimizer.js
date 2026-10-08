/* =====================================================================
   optimizer.js — "Stretch module": turns raw TAC into optimized TAC,
   and partitions TAC into basic blocks (leader algorithm).

   Three safe, classic passes, run to a fixed point:
     1. Constant folding   — t = NUM op NUM  =>  t = VALUE
     2. Copy propagation   — inline a temp's constant value at its
                              single use site, for compiler-generated
                              temporaries only (t1, t2, ...).
     3. Dead code elim.    — drop a temp definition once it has no
                              remaining uses.

   Why only temps (never named variables)? Every temp is assigned
   exactly once by ir.js (write-once / SSA-style), so substituting its
   value anywhere it's used is always safe — even inside a loop body,
   because the temp is still recomputed fresh on every pass through
   that code. Named variables (i, sum, ...) CAN be reassigned across
   branches/iterations, so we deliberately leave them alone: folding
   through them would be unsound in the general case.
   ===================================================================== */

function isNumLiteral(s) { return /^-?\d+(\.\d+)?$/.test(s); }
function isTemp(s) { return /^t\d+$/.test(s); }

function parseLine(line) {
  let m;
  if ((m = line.match(/^(\w+):$/))) return { kind: "label", name: m[1] };
  if ((m = line.match(/^goto (\w+)$/))) return { kind: "goto", target: m[1] };
  if ((m = line.match(/^ifFalse (\S+) goto (\w+)$/))) return { kind: "condjump", cond: m[1], target: m[2] };
  if ((m = line.match(/^print (\S+)$/))) return { kind: "print", value: m[1] };
  if ((m = line.match(/^(\w+) = -(\S+)$/))) return { kind: "unary", target: m[1], value: m[2] };
  if ((m = line.match(/^(\w+) = (\S+) (\S+) (\S+)$/))) return { kind: "binop", target: m[1], left: m[2], op: m[3], right: m[4] };
  if ((m = line.match(/^(\w+) = (\S+)$/))) return { kind: "copy", target: m[1], source: m[2] };
  return { kind: "other", raw: line };
}

function formatLine(p) {
  switch (p.kind) {
    case "label": return `${p.name}:`;
    case "goto": return `goto ${p.target}`;
    case "condjump": return `ifFalse ${p.cond} goto ${p.target}`;
    case "print": return `print ${p.value}`;
    case "unary": return `${p.target} = -${p.value}`;
    case "binop": return `${p.target} = ${p.left} ${p.op} ${p.right}`;
    case "copy": return `${p.target} = ${p.source}`;
    default: return p.raw;
  }
}

function evalBinop(op, a, b) {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b !== 0 ? a / b : 0;
    case "<": return a < b ? 1 : 0;
    case ">": return a > b ? 1 : 0;
    case "==": return a === b ? 1 : 0;
    case "!=": return a !== b ? 1 : 0;
    case "<=": return a <= b ? 1 : 0;
    case ">=": return a >= b ? 1 : 0;
    case "&&": return (a && b) ? 1 : 0;
    case "||": return (a || b) ? 1 : 0;
    default: return null;
  }
}

/** One constant-folding pass: t = NUM op NUM  ->  t = VALUE (as a copy). */
function foldPass(parsed) {
  let foldedCount = 0;
  const next = parsed.map((p) => {
    if (p.kind === "binop" && isTemp(p.target) && isNumLiteral(p.left) && isNumLiteral(p.right)) {
      const val = evalBinop(p.op, parseFloat(p.left), parseFloat(p.right));
      if (val !== null) { foldedCount++; return { kind: "copy", target: p.target, source: String(val) }; }
    }
    if (p.kind === "unary" && isTemp(p.target) && isNumLiteral(p.value)) {
      foldedCount++;
      return { kind: "copy", target: p.target, source: String(-parseFloat(p.value)) };
    }
    return p;
  });
  return { parsed: next, foldedCount };
}

/** One copy-propagation + dead-code-elimination pass, temps only. */
function propagatePass(parsed) {
  const useCount = {};
  function noteUse(tok) { if (isTemp(tok)) useCount[tok] = (useCount[tok] || 0) + 1; }
  for (const p of parsed) {
    if (p.kind === "binop") { noteUse(p.left); noteUse(p.right); }
    else if (p.kind === "unary") { noteUse(p.value); }
    else if (p.kind === "copy") { noteUse(p.source); }
    else if (p.kind === "print") { noteUse(p.value); }
    else if (p.kind === "condjump") { noteUse(p.cond); }
  }

  const constDefs = {};
  parsed.forEach((p, idx) => {
    if (p.kind === "copy" && isTemp(p.target) && isNumLiteral(p.source)) constDefs[p.target] = { value: p.source, idx };
  });

  const removedIdx = new Set();
  let changed = false;
  for (const [tname, info] of Object.entries(constDefs)) {
    const uses = useCount[tname] || 0;
    if (uses === 1) {
      for (const p of parsed) {
        if (p.kind === "binop") { if (p.left === tname) p.left = info.value; if (p.right === tname) p.right = info.value; }
        else if (p.kind === "unary") { if (p.value === tname) p.value = info.value; }
        else if (p.kind === "copy") { if (p.source === tname) p.source = info.value; }
        else if (p.kind === "print") { if (p.value === tname) p.value = info.value; }
        else if (p.kind === "condjump") { if (p.cond === tname) p.cond = info.value; }
      }
      removedIdx.add(info.idx); changed = true;
    } else if (uses === 0) {
      removedIdx.add(info.idx); changed = true;
    }
  }
  const next = parsed.filter((_, idx) => !removedIdx.has(idx));
  return { parsed: next, removed: removedIdx.size, changed };
}

/** Run folding + propagation to a fixed point (handles chained constant exprs). */
function optimize(instructions) {
  let parsed = instructions.map(parseLine);
  let totalFolded = 0, totalRemoved = 0;

  for (let iter = 0; iter < 10; iter++) {
    const f = foldPass(parsed);
    parsed = f.parsed;
    totalFolded += f.foldedCount;

    const p = propagatePass(parsed);
    parsed = p.parsed;
    totalRemoved += p.removed;

    if (f.foldedCount === 0 && p.removed === 0) break;
  }

  const optimized = parsed.map(formatLine);
  return {
    original: instructions,
    optimized,
    stats: {
      originalCount: instructions.length,
      optimizedCount: optimized.length,
      foldedCount: totalFolded,
      removedCount: totalRemoved,
    },
  };
}

/** Leader-based basic-block partitioning of a TAC instruction list. */
function partitionBasicBlocks(instructions) {
  const n = instructions.length;
  if (n === 0) return [];
  const leaders = new Set([0]);

  instructions.forEach((line, i) => {
    if (/^(\w+):$/.test(line)) leaders.add(i);
  });
  instructions.forEach((line, i) => {
    if (/^goto \w+$/.test(line) || /^ifFalse .+ goto \w+$/.test(line)) {
      if (i + 1 < n) leaders.add(i + 1);
    }
  });

  const sorted = [...leaders].sort((a, b) => a - b);
  return sorted.map((start, idx) => {
    const end = idx + 1 < sorted.length ? sorted[idx + 1] : n;
    const body = instructions.slice(start, end);
    const m = body[0] && body[0].match(/^(\w+):$/);
    return { id: `B${idx}`, label: m ? m[1] : null, instructions: body };
  });
}
