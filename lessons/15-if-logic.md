# Lesson 15 — if / and / or

## Goal

wyrm learns to make decisions:

```
if (score >= 10) print "big"; else print "small";
let name = input or "stranger";
```

You'll add an `if` statement with an optional `else`, and the two logical operators `and` and
`or`. You'll grow both unions again and follow `tsc`'s error list, as you did in lesson 13.
This time one of the fixes is a single line, thanks to **case fallthrough**.

## Concepts

### `Stmt | null` for an optional branch

An `if` always has a then-branch and sometimes an else-branch. As with `let`'s initializer in
lesson 13, "sometimes" is `| null`:

```ts
interface IfStmt {
  readonly thenBranch: Stmt;
  readonly elseBranch: Stmt | null;
}
```

The interpreter has to check `elseBranch !== null` before executing it, and `tsc` won't let
it forget.

### Why `and`/`or` are not binary expressions

`a and b` looks like `a + b`: two operands, an operator in the middle. But `binary()` in the
interpreter evaluates **both** operands first, then looks at the operator. `and`/`or` must
not do that. They **short-circuit**:

- `a or b`: if `a` is truthy, the answer is `a` and `b` is never evaluated.
- `a and b`: if `a` is falsy, the answer is `a` and `b` is never evaluated.

"Never evaluated" matters as soon as `b` has an effect, like an assignment or (later) a call.
So they get their own node, `LogicalExpr`. It has the same fields as `BinaryExpr`, but a
different `kind`, which gives it a different case in the interpreter.

### `and`/`or` return an operand, not a boolean

Notice the rule above said "the answer is `a`", not "the answer is `true`". wyrm's logical
operators return one of their operands:

| Expression | Result | Why |
|---|---|---|
| `nil or "default"` | `"default"` | left is falsy, so the result is the right operand |
| `1 and 2` | `2` | left is truthy, so the result is the right operand |
| `false and 2` | `false` | left is falsy, so the result is the left operand |

That's how JavaScript's `||` and `&&` behave, and it makes `x or "default"` a handy idiom.
Used as a condition, the result still has the right truthiness, so nothing is lost.

For the types, this means `logical()` returns `Value`, not `boolean`.

### Precedence: `or` → `and` → equality

`or` binds loosest, then `and`, then everything you already have:

```
assignment  →  or  →  and  →  equality  →  comparison  →  term  →  factor  →  unary  →  primary
   lowest                                                                              highest
```

So `true or false and false` is `true or (false and false)`, which is `true`. Each new level is
one more method in the chain, shaped exactly like `equality()`.

### The dangling else

```
if (a) if (b) print "x"; else print "y";
```

Which `if` owns the `else`? The grammar is ambiguous. The usual rule, and wyrm's, is: **the
nearest one**. You get that rule for free. The inner `ifStatement()` call is the one
that's running when the parser reaches `else`, so it takes it.

### Case fallthrough, and when it's allowed

In a JavaScript `switch`, a case without `return`/`break` **falls through** into the next
case. That's usually a bug, so `noFallthroughCasesInSwitch` (in your `tsconfig.json` since
lesson 01) forbids it:

```ts
switch (kind) {
  case "a":
    doA();        // error TS7029: Fallthrough case in switch.
  case "b":
    doB();
    break;
}
```

There's one exception: an **empty** case can fall through. That's how you let several cases
share one body:

```ts
switch (kind) {
  case "circle":
  case "ellipse":
    return drawRound();   // runs for both
}
```

You already did this in the scanner (`case "(": case ")": …`). Today it pays off twice.
`printExpr` and `countNodes` treat a logical expression exactly like a binary one, so each
gets one new line, `case "logical":`, placed right below `case "binary":`. Inside the shared
body, TypeScript narrows `expr` to `BinaryExpr | LogicalExpr`. Both have `left`, `operator`
and `right`, so the body type-checks for both.

## Tests first

### `test/control-flow.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./helpers.ts";

test("if runs the then-branch when the condition is truthy", () => {
  assert.deepEqual(run('if (1 < 2) print "yes"; else print "no";').output, ["yes"]);
});

test("if runs the else-branch when the condition is falsy", () => {
  assert.deepEqual(run('if (nil) print "yes"; else print "no";').output, ["no"]);
});

test("0 and empty string are truthy", () => {
  assert.deepEqual(run('if (0) print "zero"; if ("") print "empty";').output, ["zero", "empty"]);
});

test("dangling else binds to the nearest if", () => {
  const source = 'if (true) if (false) print "inner"; else print "else";';
  assert.deepEqual(run(source).output, ["else"]);
});

test("and / or return an operand, not a boolean", () => {
  assert.deepEqual(run('print nil or "default"; print 1 and 2; print false and 2;').output, [
    "default",
    "2",
    "false",
  ]);
});

test("and / or short-circuit", () => {
  const source = `
    let calls = 0;
    true or (calls = calls + 1);
    false and (calls = calls + 1);
    print calls;
  `;
  assert.deepEqual(run(source).output, ["0"]);
});

test("and binds tighter than or", () => {
  assert.deepEqual(run("print true or false and false;").output, ["true"]);
});
```

The short-circuit test uses an assignment as a "side effect detector". If either right-hand
side ran, `calls` would be `1` or `2`.

The dangling-else test is built so that the two readings give different output. If the
`else` belonged to the outer `if (true)`, nothing would print.

Run `npm test`. All 7 new tests fail, and every one shows `actual: []`. Why empty, and why
no error message? The programs don't parse (`if`, `and`, `or` are keywords the parser doesn't
handle yet), so nothing runs, and these tests only look at `.output`. The parse errors are
in `.errors`, which the tests don't check. Keep that in mind: a test that only checks output
can pass or fail for reasons it can't see. You'll meet one that passes for the wrong reason
in lesson 16.

`npm run typecheck` is clean.

## The code

### Step 1 — Change the types first

In `src/ast.ts`, add `LogicalExpr` right after `BinaryExpr`:

```ts
export interface LogicalExpr {
  readonly kind: "logical";
  readonly left: Expr;
  readonly operator: Token;
  readonly right: Expr;
}
```

Add it to the `Expr` union, after `BinaryExpr`:

```ts
export type Expr =
  | LiteralExpr
  | GroupingExpr
  | UnaryExpr
  | BinaryExpr
  | LogicalExpr
  | VariableExpr
  | AssignExpr;
```

At the end of the file, find:

```ts
export type Stmt = ExpressionStmt | PrintStmt | LetStmt | BlockStmt;
```

Replace it with:

```ts
export interface IfStmt {
  readonly kind: "if";
  readonly condition: Expr;
  readonly thenBranch: Stmt;
  readonly elseBranch: Stmt | null;
}

export type Stmt = ExpressionStmt | PrintStmt | LetStmt | BlockStmt | IfStmt;
```

### Step 2 — Read the to-do list

```sh
npm run typecheck
```

```
src/interpreter.ts(41,21): error TS2345: Argument of type 'IfStmt' is not assignable to parameter of type 'never'.
src/interpreter.ts(75,28): error TS2345: Argument of type 'LogicalExpr' is not assignable to parameter of type 'never'.
src/printer.ts(19,26): error TS2345: Argument of type 'LogicalExpr' is not assignable to parameter of type 'never'.
test/ast.test.ts(6,34): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

The same three places as in lesson 13, plus `execute`. You know the drill: work down the list.

### Step 3 — `src/printer.ts` and `test/ast.test.ts`: one line each

In `printExpr`, find:

```ts
    case "binary":
      return parenthesize(expr.operator.lexeme, expr.left, expr.right);
```

Replace it with:

```ts
    case "binary":
    case "logical":
      return parenthesize(expr.operator.lexeme, expr.left, expr.right);
```

`a and b` prints as `(and a b)`: the lexeme of the operator token is the keyword.

In `countNodes` in `test/ast.test.ts`, do the same. Find:

```ts
    case "binary":
      return 1 + countNodes(expr.left) + countNodes(expr.right);
```

Replace it with:

```ts
    case "binary":
    case "logical":
      return 1 + countNodes(expr.left) + countNodes(expr.right);
```

`case "binary":` is now empty, so it may fall through. `noFallthroughCasesInSwitch` only
complains about cases that *do* something and then fall into the next one.

### Step 4 — `src/interpreter.ts`

Import `LogicalExpr`:

```ts
import type { BinaryExpr, Expr, LogicalExpr, Stmt, UnaryExpr } from "./ast.ts";
```

In `execute`, add a case after `"block"`, before `default`:

```ts
      case "if":
        if (isTruthy(this.evaluate(stmt.condition))) {
          this.execute(stmt.thenBranch);
        } else if (stmt.elseBranch !== null) {
          this.execute(stmt.elseBranch);
        }
        return;
```

`isTruthy` from lesson 10 decides, so only `false` and `nil` count as false. `0` and `""` take
the then-branch, just as the third test expects. The `!== null` check narrows `elseBranch` to
`Stmt`. No braces are needed around this case: it declares nothing.

In `evaluate`, add a case after `"binary"`:

```ts
      case "logical":
        return this.logical(expr);
```

And add the `logical` method right after `evaluate`, before `unary`:

```ts
  private logical(expr: LogicalExpr): Value {
    const left = this.evaluate(expr.left);
    if (expr.operator.type === "or") {
      if (isTruthy(left)) return left;
    } else {
      if (!isTruthy(left)) return left;
    }
    return this.evaluate(expr.right);
  }
```

Read it against the table in Concepts. The left side is always evaluated. Then each operator
has one situation where the answer is already known, and in that situation it returns
`left` right away, without touching `expr.right`. That early `return` *is* the
short-circuit. Otherwise the answer is simply the right operand.

The `else` branch means "the operator is `and`". The parser only ever builds a `LogicalExpr`
with `and` or `or`, so there's no third option to handle.

`tsc` should now be silent. The tests still fail, because the parser doesn't produce these
nodes yet.

### Step 5 — `src/parser.ts`

First, `if`. Add a line at the top of `statement()`:

```ts
  private statement(): Stmt {
    if (this.match("if")) return this.ifStatement();
    if (this.match("print")) return this.printStatement();
    if (this.match("{")) return { kind: "block", statements: this.block() };
    return this.expressionStatement();
  }
```

Add `ifStatement()` right after `block()`:

```ts
  private ifStatement(): Stmt {
    this.consume("(", "Expect '(' after 'if'.");
    const condition = this.expression();
    this.consume(")", "Expect ')' after if condition.");
    const thenBranch = this.statement();
    const elseBranch = this.match("else") ? this.statement() : null;
    return { kind: "if", condition, thenBranch, elseBranch };
  }
```

- The branches are parsed with `statement()`, not `declaration()`. So `if (x) let y = 1;` is
  a syntax error. A `let` whose scope is "just this branch" would be useless. Use a block:
  `if (x) { let y = 1; }`.
- `this.match("else") ? … : null` is where the dangling else is decided. When there are two
  `if`s, the inner `ifStatement()` reaches this line first and takes the `else`.

Now the two new precedence levels. In `assignment()`, change the first line so it starts one
level lower. Find:

```ts
    const expr = this.equality();
    if (this.match("=")) {
```

Replace it with:

```ts
    const expr = this.or();
    if (this.match("=")) {
```

Then add `or()` and `and()` right after `assignment()`, before `equality()`:

```ts
  private or(): Expr {
    let expr = this.and();
    while (this.match("or")) {
      const operator = this.previous();
      const right = this.and();
      expr = { kind: "logical", left: expr, operator, right };
    }
    return expr;
  }

  private and(): Expr {
    let expr = this.equality();
    while (this.match("and")) {
      const operator = this.previous();
      const right = this.equality();
      expr = { kind: "logical", left: expr, operator, right };
    }
    return expr;
  }
```

These are `equality()` with different names: a left-associative loop that calls the next
level down. Methods called `or` and `and` are fine in TypeScript. They're reserved words in
many languages, but not in JavaScript.

Run everything:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 66
ℹ pass 66
ℹ fail 0
```

59 from before plus the 7 in `control-flow.test.ts`.

Commit:

```sh
git add -A
git commit -m "Add if, and, or"
```

## Study Drills

1. **Break it on purpose.** In `printExpr`, put a line of code (any statement, e.g. a
   `console.log`) between `case "binary":` and `case "logical":`. Run `npm run typecheck` and
   read the error code and message. Then undo it.
2. **Break it on purpose.** In `ifStatement()`, change `this.statement()` for the then-branch to
   `this.declaration()`. Does any test fail? Should it? Write down what behaviour changed, then
   undo it.
3. Explain in your own words why `LogicalExpr` is a separate node instead of two more operators
   in `binary()`. Point at the exact line in `binary()` that would break the short-circuit test.
4. Change `logical()` so it returns `isTruthy(...)` of the result, i.e. always a boolean. Which
   test fails, and which test still passes that you'd have expected to fail? Then undo it.
5. **Small extension (then undo it).** Add a temporary test for
   `print nil and x or "fallback";` where `x` is never declared. Predict: runtime error or
   output? Trace the parse tree and the evaluation to justify it. Delete the test when you're done.

## Checkpoint

Tell Claude: **"lesson 15 done"**. Expect questions like: *Why is `case "binary": case
"logical":` allowed when `noFallthroughCasesInSwitch` is on? Why does `nil or "default"`
produce `"default"` and not `true`? Where exactly in the parser is the dangling else
resolved? Why does `or()` call `and()`, and not the other way round?*
