/* =====================================================================
   lexer.js — Lexical Analyzer
   Converts raw source text into a stream of tokens.
   Implemented as a hand-written DFA: at every character we are in one
   of a small set of named states (START, IN_ID, IN_NUM, IN_NUM_FRAC,
   IN_OP). The `trace` array records every state transition so the UI
   can visualize how the automaton consumes the input character by
   character — this is the "DFA visualization" piece of the pipeline.
   ===================================================================== */

const TOKEN_TYPES = {
  INT: "INT", FLOAT: "FLOAT", IF: "IF", ELSE: "ELSE",
  WHILE: "WHILE", FOR: "FOR", PRINT: "PRINT",
  IDENT: "IDENT", NUMBER: "NUMBER",
  PLUS: "PLUS", MINUS: "MINUS", STAR: "STAR", SLASH: "SLASH",
  ASSIGN: "ASSIGN", EQ: "EQ", NEQ: "NEQ",
  LT: "LT", GT: "GT", LTE: "LTE", GTE: "GTE",
  AND: "AND", OR: "OR",
  LPAREN: "LPAREN", RPAREN: "RPAREN",
  LBRACE: "LBRACE", RBRACE: "RBRACE",
  SEMI: "SEMI",
  EOF: "EOF",
};

const KEYWORDS = {
  int: TOKEN_TYPES.INT, float: TOKEN_TYPES.FLOAT,
  if: TOKEN_TYPES.IF, else: TOKEN_TYPES.ELSE,
  while: TOKEN_TYPES.WHILE, for: TOKEN_TYPES.FOR, print: TOKEN_TYPES.PRINT,
};

function isDigit(c) { return c >= "0" && c <= "9"; }
function isAlpha(c) { return /[A-Za-z_]/.test(c); }
function isAlphaNum(c) { return /[A-Za-z0-9_]/.test(c); }

/**
 * tokenize(source) -> { tokens, trace, errors }
 * tokens: [{ type, value, line, col }]
 * trace:  [{ char, pos, fromState, toState, note }]  (for DFA visualization)
 * errors: [{ message, line, col }]
 */
function tokenize(source) {
  const tokens = [];
  const trace = [];
  const errors = [];

  let i = 0, line = 1, col = 1;
  const n = source.length;

  function peek(offset = 0) { return source[i + offset]; }
  function advance() {
    const c = source[i++];
    if (c === "\n") { line++; col = 1; } else { col++; }
    return c;
  }
  function logTransition(char, fromState, toState, note) {
    trace.push({ char: char === "\n" ? "\\n" : char, pos: i, fromState, toState, note: note || "" });
  }

  while (i < n) {
    const startLine = line, startCol = col;
    let c = peek();

    // ---- STATE: START -> skip whitespace ----
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      logTransition(c, "START", "START", "skip whitespace");
      advance();
      continue;
    }

    // ---- line comments: // ... ----
    if (c === "/" && peek(1) === "/") {
      logTransition(c, "START", "IN_COMMENT", "start comment");
      while (i < n && peek() !== "\n") advance();
      continue;
    }

    // ---- STATE: IN_ID (identifiers / keywords) ----
    if (isAlpha(c)) {
      let lexeme = "";
      logTransition(c, "START", "IN_ID", "start identifier");
      while (i < n && isAlphaNum(peek())) {
        lexeme += advance();
      }
      const type = KEYWORDS[lexeme] || TOKEN_TYPES.IDENT;
      logTransition("", "IN_ID", "START", `accept ${type}("${lexeme}")`);
      tokens.push({ type, value: lexeme, line: startLine, col: startCol });
      continue;
    }

    // ---- STATE: IN_NUM (integer / float literals) ----
    if (isDigit(c)) {
      let lexeme = "";
      let isFloat = false;
      logTransition(c, "START", "IN_NUM", "start number");
      while (i < n && isDigit(peek())) lexeme += advance();
      if (peek() === "." && isDigit(peek(1))) {
        isFloat = true;
        logTransition(".", "IN_NUM", "IN_NUM_FRAC", "decimal point");
        lexeme += advance(); // consume '.'
        while (i < n && isDigit(peek())) lexeme += advance();
      }
      logTransition("", isFloat ? "IN_NUM_FRAC" : "IN_NUM", "START", `accept NUMBER("${lexeme}")`);
      tokens.push({
        type: TOKEN_TYPES.NUMBER, value: lexeme,
        numType: isFloat ? "float" : "int",
        line: startLine, col: startCol,
      });
      continue;
    }

    // ---- STATE: IN_OP (operators, possibly two-character) ----
    const two = c + (peek(1) || "");
    const twoCharOps = {
      "==": TOKEN_TYPES.EQ, "!=": TOKEN_TYPES.NEQ, "<=": TOKEN_TYPES.LTE, ">=": TOKEN_TYPES.GTE,
      "&&": TOKEN_TYPES.AND, "||": TOKEN_TYPES.OR,
    };
    if (twoCharOps[two]) {
      logTransition(c, "START", "IN_OP", "start operator");
      advance(); advance();
      logTransition("", "IN_OP", "START", `accept ${twoCharOps[two]}("${two}")`);
      tokens.push({ type: twoCharOps[two], value: two, line: startLine, col: startCol });
      continue;
    }

    const singleCharOps = {
      "+": TOKEN_TYPES.PLUS, "-": TOKEN_TYPES.MINUS, "*": TOKEN_TYPES.STAR, "/": TOKEN_TYPES.SLASH,
      "=": TOKEN_TYPES.ASSIGN, "<": TOKEN_TYPES.LT, ">": TOKEN_TYPES.GT,
      "(": TOKEN_TYPES.LPAREN, ")": TOKEN_TYPES.RPAREN,
      "{": TOKEN_TYPES.LBRACE, "}": TOKEN_TYPES.RBRACE,
      ";": TOKEN_TYPES.SEMI,
    };
    if (singleCharOps[c]) {
      logTransition(c, "START", "IN_OP", "start operator");
      advance();
      logTransition("", "IN_OP", "START", `accept ${singleCharOps[c]}("${c}")`);
      tokens.push({ type: singleCharOps[c], value: c, line: startLine, col: startCol });
      continue;
    }

    // ---- unrecognized character ----
    logTransition(c, "START", "ERROR", "no transition defined");
    errors.push({ message: `Unrecognized character '${c}'`, line: startLine, col: startCol });
    advance();
  }

  tokens.push({ type: TOKEN_TYPES.EOF, value: "", line, col });
  return { tokens, trace, errors };
}
