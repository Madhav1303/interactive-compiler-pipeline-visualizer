/* =====================================================================
   semantic.js — Semantic Analyzer
   Walks the AST maintaining a stack of scopes (one per block/loop).
   Checks:
     - redeclaration of a variable within the same scope
     - use of an undeclared variable
     - simple type compatibility (int -> float widening is allowed,
       float -> int is flagged as a possible loss of precision)
   Produces a flattened list of recorded scopes (for display) and a
   list of semantic errors.
   ===================================================================== */

function analyze(ast) {
  const errors = [];
  const scopeLog = []; // snapshots of every scope created, for display
  const scopeStack = [];

  function pushScope(label) {
    const scope = { label, vars: new Map() };
    scopeStack.push(scope);
    scopeLog.push(scope);
  }
  function popScope() { scopeStack.pop(); }

  function declare(name, varType, line) {
    const current = scopeStack[scopeStack.length - 1];
    if (current.vars.has(name)) {
      errors.push({ message: `Variable '${name}' is already declared in this scope`, line });
      return;
    }
    current.vars.set(name, varType);
  }

  function lookup(name) {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      if (scopeStack[i].vars.has(name)) return scopeStack[i].vars.get(name);
    }
    return null;
  }

  function typeOfExpr(node) {
    switch (node.type) {
      case "Num":
        return node.numType; // 'int' | 'float'
      case "Id": {
        const t = lookup(node.name);
        if (!t) {
          errors.push({ message: `Undeclared variable '${node.name}'`, line: node.line });
          return "int"; // fall back so analysis can continue
        }
        return t;
      }
      case "Unary":
        return typeOfExpr(node.value);
      case "BinOp": {
        const lt = typeOfExpr(node.left);
        const rt = typeOfExpr(node.right);
        const boolLikeOps = ["<", ">", "==", "!=", "<=", ">=", "&&", "||"];
        if (boolLikeOps.includes(node.op)) return "int"; // 0/1 result
        return (lt === "float" || rt === "float") ? "float" : "int";
      }
      default:
        return "int";
    }
  }

  function checkAssignable(targetType, exprNode, line, name) {
    const exprType = typeOfExpr(exprNode);
    if (targetType === "int" && exprType === "float") {
      errors.push({ message: `Possible loss of precision assigning float to int variable '${name}'`, line });
    }
  }

  function checkAssignStmt(node) {
    const t = lookup(node.name);
    if (!t) {
      errors.push({ message: `Undeclared variable '${node.name}'`, line: node.line });
    } else {
      checkAssignable(t, node.value, node.line, node.name);
    }
    typeOfExpr(node.value);
  }

  function visitStmt(node) {
    switch (node.type) {
      case "Program":
        pushScope("global");
        node.body.forEach(visitStmt);
        popScope();
        break;
      case "Block":
        pushScope("block");
        node.body.forEach(visitStmt);
        popScope();
        break;
      case "VarDecl":
        if (node.init) checkAssignable(node.varType, node.init, node.line, node.name);
        declare(node.name, node.varType, node.line);
        break;
      case "Assign":
        checkAssignStmt(node);
        break;
      case "If":
        typeOfExpr(node.cond);
        visitStmt(node.thenBlock);
        if (node.elseBlock) visitStmt(node.elseBlock);
        break;
      case "While":
        typeOfExpr(node.cond);
        visitStmt(node.body);
        break;
      case "For":
        pushScope("for");
        visitStmt(node.init);
        typeOfExpr(node.cond);
        checkAssignStmt(node.update);
        visitStmt(node.body);
        popScope();
        break;
      case "Print":
        typeOfExpr(node.value);
        break;
    }
  }

  if (ast) visitStmt(ast);
  return { scopeLog, errors };
}
