/* =====================================================================
   parser.js — Syntax Analyzer (Recursive Descent)
   Grammar (EBNF):
     program    := statement* EOF
     statement  := varDecl | assignStmt | ifStmt | whileStmt | forStmt
                 | printStmt | block
     varDecl    := ("int"|"float") IDENT ("=" expr)? ";"
     assignStmt := IDENT "=" expr ";"
     ifStmt     := "if" "(" expr ")" block ("else" block)?
     whileStmt  := "while" "(" expr ")" block
     forStmt    := "for" "(" (varDecl | IDENT "=" expr ";") expr ";"
                    IDENT "=" expr ")" block
     printStmt  := "print" "(" expr ")" ";"
     block      := "{" statement* "}"
     expr       := logicalOr
     logicalOr  := logicalAnd ("||" logicalAnd)*
     logicalAnd := comparison ("&&" comparison)*
     comparison := addExpr (("<"|">"|"=="|"!="|"<="|">=") addExpr)?
     addExpr    := mulExpr (("+"|"-") mulExpr)*
     mulExpr    := unary (("*"|"/") unary)*
     unary      := "-" unary | primary
     primary    := NUMBER | IDENT | "(" expr ")"

   Every production logs an entry into `trace`, which the UI renders as
   the parsing trace alongside the resulting parse tree (AST).
   ===================================================================== */

class ParseError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}

function parse(tokens) {
  let pos = 0;
  const trace = [];
  const errors = [];

  function peek() { return tokens[pos]; }
  function check(type) { return peek().type === type; }
  function advance() { return tokens[pos++]; }
  function match(type) { if (check(type)) return advance(); return null; }
  function expect(type, what) {
    if (check(type)) return advance();
    throw new ParseError(`Expected ${what} but found '${peek().value || peek().type}'`, peek().line);
  }
  function log(rule, detail) { trace.push({ rule, detail: detail || "", token: peek().value || peek().type }); }

  function parseProgram() {
    log("program", "enter");
    const body = [];
    while (!check("EOF")) body.push(parseStatement());
    log("program", "exit");
    return { type: "Program", body };
  }

  function parseStatement() {
    if (check("INT") || check("FLOAT")) return parseVarDecl();
    if (check("IF")) return parseIf();
    if (check("WHILE")) return parseWhile();
    if (check("FOR")) return parseFor();
    if (check("PRINT")) return parsePrint();
    if (check("LBRACE")) return parseBlock();
    if (check("IDENT")) return parseAssign();
    throw new ParseError(`Unexpected token '${peek().value || peek().type}'`, peek().line);
  }

  function parseVarDecl() {
    log("varDecl", "enter");
    const varType = advance().type === "INT" ? "int" : "float";
    const nameTok = expect("IDENT", "identifier");
    let init = null;
    if (match("ASSIGN")) init = parseExpr();
    expect("SEMI", "';'");
    log("varDecl", "exit");
    return { type: "VarDecl", varType, name: nameTok.value, init, line: nameTok.line };
  }

  function parseAssign() {
    log("assignStmt", "enter");
    const nameTok = advance();
    expect("ASSIGN", "'='");
    const value = parseExpr();
    expect("SEMI", "';'");
    log("assignStmt", "exit");
    return { type: "Assign", name: nameTok.value, value, line: nameTok.line };
  }

  function parseIf() {
    log("ifStmt", "enter");
    const line = advance().line; // 'if'
    expect("LPAREN", "'('");
    const cond = parseExpr();
    expect("RPAREN", "')'");
    const thenBlock = parseBlock();
    let elseBlock = null;
    if (match("ELSE")) elseBlock = parseBlock();
    log("ifStmt", "exit");
    return { type: "If", cond, thenBlock, elseBlock, line };
  }

  function parseWhile() {
    log("whileStmt", "enter");
    const line = advance().line; // 'while'
    expect("LPAREN", "'('");
    const cond = parseExpr();
    expect("RPAREN", "')'");
    const body = parseBlock();
    log("whileStmt", "exit");
    return { type: "While", cond, body, line };
  }

  function parseFor() {
    log("forStmt", "enter");
    const line = advance().line; // 'for'
    expect("LPAREN", "'('");

    let init;
    if (check("INT") || check("FLOAT")) {
      init = parseVarDecl(); // consumes its own trailing ';'
    } else if (check("IDENT")) {
      init = parseAssign(); // consumes its own trailing ';'
    } else {
      throw new ParseError("Expected a for-loop initializer", peek().line);
    }

    const cond = parseExpr();
    expect("SEMI", "';'");

    const updNameTok = expect("IDENT", "identifier");
    expect("ASSIGN", "'='");
    const updValue = parseExpr();
    const update = { type: "Assign", name: updNameTok.value, value: updValue, line: updNameTok.line };

    expect("RPAREN", "')'");
    const body = parseBlock();
    log("forStmt", "exit");
    return { type: "For", init, cond, update, body, line };
  }

  function parsePrint() {
    log("printStmt", "enter");
    const line = advance().line; // 'print'
    expect("LPAREN", "'('");
    const value = parseExpr();
    expect("RPAREN", "')'");
    expect("SEMI", "';'");
    log("printStmt", "exit");
    return { type: "Print", value, line };
  }

  function parseBlock() {
    log("block", "enter");
    expect("LBRACE", "'{'");
    const body = [];
    while (!check("RBRACE") && !check("EOF")) body.push(parseStatement());
    expect("RBRACE", "'}'");
    log("block", "exit");
    return { type: "Block", body };
  }

  function parseExpr() { return parseLogicalOr(); }

  function parseLogicalOr() {
    log("logicalOr", "enter");
    let left = parseLogicalAnd();
    while (check("OR")) {
      const opTok = advance();
      const right = parseLogicalAnd();
      left = { type: "BinOp", op: opTok.value, left, right, line: opTok.line };
    }
    log("logicalOr", "exit");
    return left;
  }

  function parseLogicalAnd() {
    log("logicalAnd", "enter");
    let left = parseComparison();
    while (check("AND")) {
      const opTok = advance();
      const right = parseComparison();
      left = { type: "BinOp", op: opTok.value, left, right, line: opTok.line };
    }
    log("logicalAnd", "exit");
    return left;
  }

  function parseComparison() {
    log("comparison", "enter");
    let left = parseAddExpr();
    const relOps = ["LT", "GT", "EQ", "NEQ", "LTE", "GTE"];
    if (relOps.includes(peek().type)) {
      const opTok = advance();
      const right = parseAddExpr();
      left = { type: "BinOp", op: opTok.value, left, right, line: opTok.line };
    }
    log("comparison", "exit");
    return left;
  }

  function parseAddExpr() {
    log("addExpr", "enter");
    let left = parseMulExpr();
    while (check("PLUS") || check("MINUS")) {
      const opTok = advance();
      const right = parseMulExpr();
      left = { type: "BinOp", op: opTok.value, left, right, line: opTok.line };
    }
    log("addExpr", "exit");
    return left;
  }

  function parseMulExpr() {
    log("mulExpr", "enter");
    let left = parseUnary();
    while (check("STAR") || check("SLASH")) {
      const opTok = advance();
      const right = parseUnary();
      left = { type: "BinOp", op: opTok.value, left, right, line: opTok.line };
    }
    log("mulExpr", "exit");
    return left;
  }

  function parseUnary() {
    if (check("MINUS")) {
      const opTok = advance();
      const value = parseUnary();
      return { type: "Unary", op: "-", value, line: opTok.line };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    log("primary", "enter");
    if (check("NUMBER")) {
      const t = advance();
      log("primary", "exit");
      return { type: "Num", value: t.value, numType: t.numType, line: t.line };
    }
    if (check("IDENT")) {
      const t = advance();
      log("primary", "exit");
      return { type: "Id", name: t.value, line: t.line };
    }
    if (check("LPAREN")) {
      advance();
      const e = parseExpr();
      expect("RPAREN", "')'");
      log("primary", "exit");
      return e;
    }
    throw new ParseError(`Expected an expression but found '${peek().value || peek().type}'`, peek().line);
  }

  let ast = null;
  try {
    ast = parseProgram();
  } catch (e) {
    if (e instanceof ParseError) {
      errors.push({ message: e.message, line: e.line });
    } else {
      throw e;
    }
  }

  return { ast, trace, errors };
}
