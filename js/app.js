/* =====================================================================
   app.js — glue code: reads source from the textarea, runs the full
   pipeline (lexer -> parser -> semantic analysis -> TAC -> optimizer),
   pushes results into every visualization panel, and drives the
   lexer's step-by-step DFA playback.
   ===================================================================== */

const SAMPLES = {
  sum_compare: `int a = 5;
int b = 10;
int sum = a + b;
if (sum > 10) {
  print(sum);
} else {
  print(a);
}`,
  while_countdown: `int i = 5;
while (i > 0) {
  print(i);
  i = i - 1;
}`,
  for_loop: `int sum = 0;
for (int i = 0; i < 5; i = i + 1) {
  sum = sum + i;
}
print(sum);`,
  logical_ops: `int a = 5;
int b = 10;
if (a > 0 && b > 0) {
  print(a + b);
} else {
  print(0);
}`,
  constant_fold: `int x = 2 + 3 * 4;
print(x);`,
  float_mix: `float avg = 0;
int total = 7;
int count = 2;
avg = total / count;
print(avg);`,
  semantic_error: `int x = 5;
y = 10;
print(x + y);`,
  syntax_error: `int x = 5
print(x);`,
};

function $(id) { return document.getElementById(id); }

function loadSample(key) {
  if (SAMPLES[key]) $("source").value = SAMPLES[key];
}

function setTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
}

function badge(count) {
  if (count === 0) return "";
  return `<span class="badge badge-err">${count}</span>`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ *
 * DFA step-through playback: steps through the lexer's trace array,
 * highlighting the current source character and the matching trace
 * row at the same time.
 * ------------------------------------------------------------------ */
const playback = { trace: [], index: 0, timer: null, speedMs: 450 };

function playbackReset(trace) {
  clearInterval(playback.timer);
  playback.timer = null;
  playback.trace = trace;
  playback.index = 0;
  updatePlaybackUI();
}

function updatePlaybackUI() {
  const total = playback.trace.length;
  $("playback-counter").textContent = total ? `Step ${Math.min(playback.index, total)} / ${total}` : "No trace";

  document.querySelectorAll(".src-char").forEach((el) => el.classList.remove("src-char-current"));
  document.querySelectorAll("#dfa-trace-table tbody tr").forEach((el) => el.classList.remove("trace-row-current"));

  if (playback.index > 0 && playback.index <= total) {
    const step = playback.trace[playback.index - 1];
    const row = document.querySelector(`#dfa-trace-table tbody tr[data-trace-idx="${playback.index - 1}"]`);
    if (row) { row.classList.add("trace-row-current"); row.scrollIntoView({ block: "nearest" }); }
    const charEl = document.querySelector(`.src-char[data-pos="${step.pos - 1}"]`);
    if (charEl) charEl.classList.add("src-char-current");
  }
}

function playbackStep() {
  if (playback.index < playback.trace.length) {
    playback.index++;
    updatePlaybackUI();
  } else {
    playbackPause();
  }
}

function playbackPlay() {
  if (playback.timer || !playback.trace.length) return;
  playback.timer = setInterval(playbackStep, playback.speedMs);
  $("play-btn").textContent = "\u23F8 Pause";
}

function playbackPause() {
  clearInterval(playback.timer);
  playback.timer = null;
  $("play-btn").textContent = "\u25B6 Play";
}

function playbackTogglePlay() {
  if (playback.timer) playbackPause(); else playbackPlay();
}

/* ------------------------------------------------------------------ *
 * Main pipeline run
 * ------------------------------------------------------------------ */
let lastResult = {};

function runPipeline() {
  playbackPause();
  const source = $("source").value;

  // ---- Phase 1: Lexical analysis ----
  const { tokens, trace: lexTrace, errors: lexErrors } = tokenize(source);
  $("panel-tokens").innerHTML = `
    <div class="playback-bar">
      <button id="play-btn" class="small-btn">&#9654; Play</button>
      <button id="step-btn" class="small-btn">&#9197; Step</button>
      <button id="reset-btn" class="small-btn">&#9198; Reset</button>
      <label class="speed-label">Speed
        <input type="range" id="speed-range" min="80" max="1000" step="20" value="${playback.speedMs}">
      </label>
      <span id="playback-counter" class="muted"></span>
    </div>
    <div class="split">
      <div>
        <h3>Source (highlighted as the DFA consumes it)</h3>
        ${renderSourceChars(source)}
        <h3 style="margin-top:0.9rem">Token Stream</h3>
        ${renderTokens(tokens)}
      </div>
      <div><h3>DFA State Trace</h3>${renderDfaTrace(lexTrace)}</div>
    </div>
    <h3>Lexical Errors</h3>${renderErrors(lexErrors, "lexical")}
    <button id="download-tokens-btn" class="small-btn">&#8681; Download tokens (.json)</button>`;

  playbackReset(lexTrace);
  $("play-btn").addEventListener("click", playbackTogglePlay);
  $("step-btn").addEventListener("click", () => { playbackPause(); playbackStep(); });
  $("reset-btn").addEventListener("click", () => { playback.index = 0; playbackPause(); updatePlaybackUI(); });
  $("speed-range").addEventListener("input", (e) => {
    playback.speedMs = Number(e.target.value);
    if (playback.timer) { playbackPause(); playbackPlay(); }
  });
  $("download-tokens-btn").addEventListener("click", () => downloadText("tokens.json", JSON.stringify(tokens, null, 2)));

  // ---- Phase 2: Syntax analysis ----
  const { ast, trace: parseTrace, errors: parseErrors } = parse(tokens);
  $("panel-parse").innerHTML = `
    <div class="split">
      <div><h3>Parse Tree (AST)</h3>${renderParseTree(ast)}</div>
      <div><h3>Parsing Trace</h3>${renderParseTrace(parseTrace)}</div>
    </div>
    <h3>Syntax Errors</h3>${renderErrors(parseErrors, "syntax")}
    ${ast ? `<button id="download-ast-btn" class="small-btn">&#8681; Download AST (.json)</button>` : ""}`;
  if (ast) $("download-ast-btn").addEventListener("click", () => downloadText("ast.json", JSON.stringify(ast, null, 2)));

  // ---- Phase 3: Semantic analysis ----
  let semResult = { scopeLog: [], errors: [] };
  if (ast) semResult = analyze(ast);
  $("panel-semantic").innerHTML = `
    <div class="split">
      <div><h3>Symbol Table</h3>${renderSymbolTable(semResult.scopeLog)}</div>
      <div><h3>Semantic Errors</h3>${renderErrors(semResult.errors, "semantic")}</div>
    </div>`;

  // ---- Phase 4: Intermediate code + optimization + basic blocks ----
  let irResult = { instructions: [] };
  let optResult = null;
  let blocks = [];
  if (ast && parseErrors.length === 0) {
    irResult = generate(ast);
    optResult = optimize(irResult.instructions);
    blocks = partitionBasicBlocks(irResult.instructions);
  }
  $("panel-ir").innerHTML = `
    <div class="split">
      <div>
        <h3>Three-Address Code (unoptimized)</h3>
        ${renderTAC(irResult.instructions)}
        ${irResult.instructions.length ? `<button id="download-tac-btn" class="small-btn">&#8681; Download TAC (.txt)</button>` : ""}
      </div>
      <div>
        <h3>Optimized TAC (constant folding + copy propagation + dead-code elim.)</h3>
        ${optResult ? renderOptimizerStats(optResult.stats) : ""}
        ${optResult ? renderTAC(optResult.optimized, "tac-optimized") : `<p class="empty">Fix errors above to generate IR.</p>`}
      </div>
    </div>
    <h3 style="margin-top:1.1rem">Basic Blocks (leader-based partition)</h3>
    ${renderBasicBlocks(blocks)}`;
  if (irResult.instructions.length) {
    $("download-tac-btn").addEventListener("click", () => downloadText("tac.txt", irResult.instructions.join("\n")));
  }

  // ---- Overview tab ----
  $("panel-overview").innerHTML = renderOverview({
    lexErrors, parseErrors, semErrors: semResult.errors,
    tokenCount: tokens.length, astOk: !!ast, scopeCount: semResult.scopeLog.length,
    tacCount: irResult.instructions.length, blockCount: blocks.length,
    optStats: optResult ? optResult.stats : null,
  });

  // ---- tab badges ----
  $("badge-tokens").innerHTML = badge(lexErrors.length);
  $("badge-parse").innerHTML = badge(parseErrors.length);
  $("badge-semantic").innerHTML = badge(semResult.errors.length);

  lastResult = { tokens, ast, semResult, irResult, optResult, blocks };
}

window.addEventListener("DOMContentLoaded", () => {
  $("run-btn").addEventListener("click", runPipeline);
  $("sample-select").addEventListener("change", (e) => {
    if (e.target.value) loadSample(e.target.value);
  });
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  });
  loadSample("sum_compare");
  runPipeline();
});
