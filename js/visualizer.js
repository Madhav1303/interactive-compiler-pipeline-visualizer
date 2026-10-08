/* =====================================================================
   visualizer.js — turns pipeline output into DOM/HTML for the UI.
   Kept deliberately framework-free (plain DOM strings) so the whole
   project runs by just opening index.html — no build step, no server.
   ===================================================================== */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderTokens(tokens) {
  if (!tokens.length) return `<p class="empty">No tokens yet. Click Run.</p>`;
  let rows = tokens.map((t, idx) => `
    <tr>
      <td>${idx}</td>
      <td><span class="tag">${t.type}</span></td>
      <td><code>${escapeHtml(t.value)}</code></td>
      <td>${t.line}:${t.col}</td>
    </tr>`).join("");
  return `
    <table class="data-table">
      <thead><tr><th>#</th><th>Type</th><th>Lexeme</th><th>Line:Col</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Source text rendered as one <span> per character, for playback highlighting. */
function renderSourceChars(source) {
  let html = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const display = ch === "\n" ? "\n" : ch;
    html += `<span class="src-char" data-pos="${i}">${escapeHtml(display)}</span>`;
  }
  return `<pre class="src-view" id="src-view">${html}</pre>`;
}

function renderDfaTrace(trace) {
  if (!trace.length) return `<p class="empty">No trace yet.</p>`;
  let rows = trace.map((t, idx) => `
    <tr data-trace-idx="${idx}">
      <td><code>${escapeHtml(t.char ?? "")}</code></td>
      <td><span class="state">${t.fromState}</span> &rarr; <span class="state">${t.toState}</span></td>
      <td class="muted">${escapeHtml(t.note)}</td>
    </tr>`).join("");
  return `
    <table class="data-table small" id="dfa-trace-table">
      <thead><tr><th>Char</th><th>State transition</th><th>Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function exprToString(node) {
  if (!node) return "";
  switch (node.type) {
    case "Num": return node.value;
    case "Id": return node.name;
    case "Unary": return `-${exprToString(node.value)}`;
    case "BinOp": return `(${exprToString(node.left)} ${node.op} ${exprToString(node.right)})`;
    default: return "?";
  }
}

function astNodeLabel(node) {
  switch (node.type) {
    case "Program": return "Program";
    case "Block": return "Block";
    case "VarDecl": return `VarDecl: ${node.varType} ${node.name}`;
    case "Assign": return `Assign: ${node.name} =`;
    case "If": return "If";
    case "While": return "While";
    case "For": return "For";
    case "Print": return "Print";
    case "BinOp": return `BinOp '${node.op}'`;
    case "Unary": return `Unary '-'`;
    case "Num": return `Num ${node.value}`;
    case "Id": return `Id ${node.name}`;
    default: return node.type;
  }
}

function astChildren(node) {
  switch (node.type) {
    case "Program":
    case "Block":
      return node.body.map((n) => ({ label: null, node: n }));
    case "VarDecl":
      return node.init ? [{ label: "init", node: node.init }] : [];
    case "Assign":
      return [{ label: "value", node: node.value }];
    case "If": {
      const c = [{ label: "cond", node: node.cond }, { label: "then", node: node.thenBlock }];
      if (node.elseBlock) c.push({ label: "else", node: node.elseBlock });
      return c;
    }
    case "While":
      return [{ label: "cond", node: node.cond }, { label: "body", node: node.body }];
    case "For":
      return [
        { label: "init", node: node.init }, { label: "cond", node: node.cond },
        { label: "update", node: node.update }, { label: "body", node: node.body },
      ];
    case "Print":
      return [{ label: "value", node: node.value }];
    case "BinOp":
      return [{ label: "left", node: node.left }, { label: "right", node: node.right }];
    case "Unary":
      return [{ label: "value", node: node.value }];
    default:
      return [];
  }
}

function renderAstNode(node) {
  const kids = astChildren(node);
  const kidsHtml = kids.map((k) => `
    <li>
      ${k.label ? `<span class="edge-label">${k.label}</span>` : ""}
      ${renderAstNode(k.node)}
    </li>`).join("");
  return `
    <div class="ast-node">${escapeHtml(astNodeLabel(node))}</div>
    ${kids.length ? `<ul class="ast-children">${kidsHtml}</ul>` : ""}`;
}

function renderParseTree(ast) {
  if (!ast) return `<p class="empty">No parse tree — fix syntax errors first.</p>`;
  return `<div class="tree-wrap"><ul class="ast-root"><li>${renderAstNode(ast)}</li></ul></div>`;
}

function renderParseTrace(trace) {
  if (!trace.length) return "";
  const rows = trace.map((t) => `
    <div class="trace-row ${t.detail === "enter" ? "trace-enter" : "trace-exit"}">
      ${t.detail === "enter" ? "&rarr;" : "&larr;"} <strong>${t.rule}</strong>
      <span class="muted">${t.detail}</span> looking at <code>${escapeHtml(t.token)}</code>
    </div>`).join("");
  return `<div class="trace-list">${rows}</div>`;
}

function renderSymbolTable(scopeLog) {
  if (!scopeLog.length) return `<p class="empty">No symbol table yet.</p>`;
  return scopeLog.map((scope, idx) => {
    if (scope.vars.size === 0) {
      return `<div class="scope-block"><h4>Scope #${idx} (${scope.label}) — empty</h4></div>`;
    }
    const rows = [...scope.vars.entries()].map(([name, type]) => `
      <tr><td><code>${escapeHtml(name)}</code></td><td><span class="tag">${type}</span></td></tr>
    `).join("");
    return `
      <div class="scope-block">
        <h4>Scope #${idx} (${scope.label})</h4>
        <table class="data-table small">
          <thead><tr><th>Name</th><th>Type</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");
}

function renderErrors(errors, kind) {
  if (!errors.length) return `<p class="ok-msg">&#10003; No ${kind} errors.</p>`;
  const rows = errors.map((e) => `
    <li class="error-row">Line ${e.line ?? "?"}: ${escapeHtml(e.message)}</li>
  `).join("");
  return `<ul class="error-list">${rows}</ul>`;
}

function renderTAC(instructions, highlightClass) {
  if (!instructions.length) return `<p class="empty">No intermediate code yet.</p>`;
  const rows = instructions.map((ins, idx) => {
    const isLabel = /:$/.test(ins.trim());
    return `<div class="tac-line ${isLabel ? "tac-label" : ""}"><span class="tac-idx">${idx + 1}</span>${escapeHtml(ins)}</div>`;
  }).join("");
  return `<div class="tac-block ${highlightClass || ""}">${rows}</div>`;
}

function renderOptimizerStats(stats) {
  const pct = stats.originalCount > 0
    ? Math.round(100 * (stats.originalCount - stats.optimizedCount) / stats.originalCount)
    : 0;
  return `
    <div class="opt-stats">
      <div class="opt-stat"><span class="opt-num">${stats.originalCount}</span><span>original lines</span></div>
      <div class="opt-stat"><span class="opt-num">${stats.optimizedCount}</span><span>optimized lines</span></div>
      <div class="opt-stat"><span class="opt-num">${stats.foldedCount}</span><span>constants folded</span></div>
      <div class="opt-stat opt-highlight"><span class="opt-num">${pct}%</span><span>size reduction</span></div>
    </div>`;
}

function renderBasicBlocks(blocks) {
  if (!blocks.length) return `<p class="empty">No basic blocks yet.</p>`;
  return `<div class="block-grid">${blocks.map((b) => `
    <div class="basic-block">
      <div class="basic-block-head">${b.id}${b.label ? ` <span class="muted">(${b.label})</span>` : ""}</div>
      <div class="basic-block-body">${b.instructions.map((i) => `<div>${escapeHtml(i)}</div>`).join("")}</div>
    </div>`).join("")}</div>`;
}

function renderOverview(data) {
  const phases = [
    { name: "Lexical Analysis", errors: data.lexErrors, count: data.tokenCount, unit: "tokens" },
    { name: "Syntax Analysis", errors: data.parseErrors, count: data.astOk ? 1 : 0, unit: "AST built" },
    { name: "Semantic Analysis", errors: data.semErrors, count: data.scopeCount, unit: "scopes" },
    { name: "IR Generation", errors: [], count: data.tacCount, unit: "TAC lines" },
  ];
  const cards = phases.map((p) => {
    const ok = p.errors.length === 0;
    return `
      <div class="overview-card ${ok ? "ok" : "fail"}">
        <div class="overview-status">${ok ? "&#10003;" : "&#10007;"}</div>
        <div class="overview-name">${p.name}</div>
        <div class="overview-detail">${ok ? `${p.count} ${p.unit}` : `${p.errors.length} error(s)`}</div>
      </div>`;
  }).join("");

  const optLine = data.optStats
    ? `<p>Peephole optimization reduced the TAC from <strong>${data.optStats.originalCount}</strong> to
       <strong>${data.optStats.optimizedCount}</strong> instructions
       (${data.optStats.foldedCount} constant-folded, ${data.optStats.removedCount} removed as dead code).</p>`
    : `<p class="empty">Run a program with syntax/semantic errors cleared to see optimization stats.</p>`;

  return `
    <div class="overview-grid">${cards}</div>
    <div class="overview-summary">
      <h3>Pipeline summary</h3>
      ${optLine}
      <p class="muted">Basic blocks: <strong>${data.blockCount}</strong> &middot; Scopes analyzed: <strong>${data.scopeCount}</strong></p>
    </div>`;
}
