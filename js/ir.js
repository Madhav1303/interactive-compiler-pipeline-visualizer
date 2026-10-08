/* =====================================================================
   ir.js — Intermediate Code Generator
   Walks the AST and emits Three-Address Code (TAC): one operation per
   instruction, using temporaries (t1, t2, ...) and labels (L1, L2, ...)
   for control flow. This is the classic teaching IR used in most
   compiler-design courses. Every temporary is assigned exactly once
   (write-once / SSA-style), which is what lets optimizer.js safely
   constant-fold and copy-propagate through them later.
   ===================================================================== */

function generate(ast) {
  const instructions = [];
  let tempCount = 0;
  let labelCount = 0;

  function newTemp() { return `t${++tempCount}`; }
  function newLabel() { return `L${++labelCount}`; }
  function emit(text) { instructions.push(text); }

  function genExpr(node) {
    switch (node.type) {
      case "Num":
        return node.value;
      case "Id":
        return node.name;
      case "Unary": {
        const v = genExpr(node.value);
        const t = newTemp();
        emit(`${t} = -${v}`);
        return t;
      }
      case "BinOp": {
        const l = genExpr(node.left);
        const r = genExpr(node.right);
        const t = newTemp();
        emit(`${t} = ${l} ${node.op} ${r}`);
        return t;
      }
      default:
        return "?";
    }
  }

  function genStmt(node) {
    switch (node.type) {
      case "Program":
      case "Block":
        node.body.forEach(genStmt);
        break;
      case "VarDecl": {
        if (node.init) {
          const v = genExpr(node.init);
          emit(`${node.name} = ${v}`);
        }
        break;
      }
      case "Assign": {
        const v = genExpr(node.value);
        emit(`${node.name} = ${v}`);
        break;
      }
      case "If": {
        const cond = genExpr(node.cond);
        const Lfalse = newLabel();
        emit(`ifFalse ${cond} goto ${Lfalse}`);
        genStmt(node.thenBlock);
        if (node.elseBlock) {
          const Lend = newLabel();
          emit(`goto ${Lend}`);
          emit(`${Lfalse}:`);
          genStmt(node.elseBlock);
          emit(`${Lend}:`);
        } else {
          emit(`${Lfalse}:`);
        }
        break;
      }
      case "While": {
        const Lstart = newLabel();
        const Lend = newLabel();
        emit(`${Lstart}:`);
        const cond = genExpr(node.cond);
        emit(`ifFalse ${cond} goto ${Lend}`);
        genStmt(node.body);
        emit(`goto ${Lstart}`);
        emit(`${Lend}:`);
        break;
      }
      case "For": {
        genStmt(node.init);
        const Lstart = newLabel();
        const Lend = newLabel();
        emit(`${Lstart}:`);
        const cond = genExpr(node.cond);
        emit(`ifFalse ${cond} goto ${Lend}`);
        genStmt(node.body);
        genStmt(node.update);
        emit(`goto ${Lstart}`);
        emit(`${Lend}:`);
        break;
      }
      case "Print": {
        const v = genExpr(node.value);
        emit(`print ${v}`);
        break;
      }
    }
  }

  if (ast) genStmt(ast);
  return { instructions };
}
