# Lesson 17 — Functions

## Goal

Give wyrm functions: `fn greet(name) { print "hello " + name; }` declares one, and
`greet("wyrm")` calls it. Functions are values, so you can store them in variables, print
them, and call the result of a call (`f(1)(2)`). Calling a non-function, or calling with the
wrong number of arguments, is a runtime error reported at the call's closing `)`.

There is no `return` yet. Every call gives back `nil`. That comes in lesson 18.

The TypeScript ideas are small but new: a class field whose type is a literal, a getter, and a
pair of files that import each other.

## Concepts

### `readonly` fields keep their literal type

TypeScript *widens* a literal when the thing holding it can change:

```ts
class A {
  tag = "a";          // type: string   (you could assign "b" later)
}
class B {
  readonly tag = "b"; // type: "b"      (it can never change, so it stays exact)
}
```

It's the same rule as `let x = "a"` (type `string`) vs `const x = "a"` (type `"a"`). A
`readonly` field with an initializer acts like a `const`.

wyrm's function class gets `readonly kind = "function"`. The field's type is the literal
`"function"`, which later lets code tell one kind of callable from another, the same way AST
nodes use `kind`.

### Getters

A getter is a method that you read like a property:

```ts
class Rect {
  private readonly w: number;
  private readonly h: number;
  constructor(w: number, h: number) { this.w = w; this.h = h; }
  get area(): number {
    return this.w * this.h;
  }
}
new Rect(2, 3).area; // 6, no parentheses
```

Use a getter when a value is *computed from* state the object already has. Storing `area` as a
separate field would mean two sources of truth that could drift apart. A getter with no
setter is read-only: `rect.area = 1` is a type error.

A wyrm function's **arity** is exactly that: the number of parameters in its declaration.
So `arity` is a getter over `declaration.params.length`.

### Circular imports

Look at which files need which:

```
value.ts ──(type)──► function.ts     Value includes WyrmFunction
function.ts ──(type)──► value.ts      call() takes and returns Values
function.ts ──(type)──► interpreter.ts   call() receives the Interpreter
interpreter.ts ──────► function.ts    `new WyrmFunction(...)` at runtime
```

`value.ts` and `function.ts` import each other, and so do `function.ts` and
`interpreter.ts`. That's a **cycle**. Real runtime cycles between ES modules are fragile.
When module A imports B and B imports A, one of them has to run its top-level code first,
while the other's exports don't exist yet:

```ts
// a.ts
import { B } from "./b.ts";
export class A {}
console.log(B.name);

// b.ts
import { A } from "./a.ts";
export class B {}
console.log(A.name); // runs first when you start a.ts
```

`node a.ts` crashes with `ReferenceError: Cannot access 'A' before initialization`. `b.ts`
ran its top level while `a.ts` was still waiting on its own import.

**Type-only imports don't have this problem, because they don't exist at runtime.** The type
stripper deletes `import type { … }` completely. So from Node's point of view, `value.ts`
imports nothing, and `function.ts` never imports `interpreter.ts`. The only runtime arrow in
the picture is `interpreter.ts → function.ts`, which points one way. The cycle is real for
`tsc`, which is fine, because `tsc` reads all the files at once and has no load order.

This is where `verbatimModuleSyntax` (lesson 01, ADR 0001) pays off. The rule is: an import
is deleted **only if it says `type`**. You can see which imports survive into JavaScript just
by reading them. `import type { Interpreter }` in `function.ts` is a promise that
`function.ts` only uses `Interpreter` as a type. If you ever use it as a value
(`new Interpreter()`), `tsc` tells you the type-only import can't be used that way.

### Narrowing an object out of a union

After this lesson:

```ts
type Value = number | string | boolean | null | WyrmFunction;
```

To call something, you need the `WyrmFunction` part. `typeof` gives `"object"` for class
instances. It **also** gives `"object"` for `null`, a famous JavaScript mistake that
TypeScript models faithfully:

```ts
function f(v: number | null | Date) {
  if (typeof v !== "object") return;  // v: null | Date
  if (v === null) return;             // v: Date
  v.getTime();
}
```

So the guard is `typeof callee !== "object" || callee === null`. After the `if` that throws,
the only member left is the function. The check doesn't mention `WyrmFunction` at all. It
removes everything that *isn't* callable, so it keeps working when a second kind of callable
joins the union in lesson 20.

### `?? null` under `noUncheckedIndexedAccess`

`args[i]` on a `readonly Value[]` has type `Value | undefined`, because the index might be
out of range. `??` replaces only `null` and `undefined`:

```ts
const xs: (number | null)[] = [0];
xs[0] || null;  // null: 0 is falsy, so || throws it away. Wrong!
xs[0] ?? null;  // 0
xs[5] ?? null;  // null
```

`args[i] ?? null` turns "no such argument" into wyrm's `nil`. It can't change a real
argument, even `false` or `0`. (`||` would turn those into `nil`.) The arity check means the
index is never actually out of range, but the compiler can't know that, and you're not allowed
to silence it with `!`.

## Tests first

Create `test/functions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./helpers.ts";

test("declare and call a function", () => {
  const source = `
    fn greet(name) {
      print "hello " + name;
    }
    greet("wyrm");
    greet("dragon");
  `;
  assert.deepEqual(run(source).output, ["hello wyrm", "hello dragon"]);
});

test("functions are values", () => {
  const source = `
    fn roar() { print "ROAR"; }
    let f = roar;
    f();
    print f;
  `;
  assert.deepEqual(run(source).output, ["ROAR", "<fn roar>"]);
});

test("a function without return gives nil", () => {
  assert.deepEqual(run("fn nothing() {} print nothing();").output, ["nil"]);
});

test("recursion", () => {
  const source = `
    fn countdown(n) {
      if (n > 0) {
        print n;
        countdown(n - 1);
      }
    }
    countdown(3);
  `;
  assert.deepEqual(run(source).output, ["3", "2", "1"]);
});

test("parameters are local to the call", () => {
  const source = `
    fn f(x) { print x; }
    f(1);
    print x;
  `;
  assert.deepEqual(run(source), {
    output: ["1"],
    errors: ["[4:11] Runtime error: Undefined variable 'x'."],
  });
});

test("wrong number of arguments", () => {
  assert.deepEqual(run("fn f(a, b) {} f(1);").errors, [
    "[1:18] Runtime error: Expected 2 arguments but got 1.",
  ]);
});

test("calling something that is not a function", () => {
  assert.deepEqual(run('"dragon"();').errors, ["[1:10] Runtime error: Can only call functions."]);
});

test("missing parameter name", () => {
  assert.deepEqual(run("fn f(1) {}").errors, ["[1:6] Error at '1': Expect parameter name."]);
});
```

Look at the error columns. In `fn f(a, b) {} f(1);`, column 18 is the `)` of the call, not
the `f`. Errors about a call are reported at its closing parenthesis.

The AST test in `test/ast.test.ts` has a `countNodes` switch over every expression kind.
Add a case for calls between `"logical"` and `"variable"`:

Find this:

```ts
    case "binary":
    case "logical":
      return 1 + countNodes(expr.left) + countNodes(expr.right);
    case "variable":
```

Replace it with:

```ts
    case "binary":
    case "logical":
      return 1 + countNodes(expr.left) + countNodes(expr.right);
    case "call":
      return 1 + countNodes(expr.callee) + expr.args.reduce((sum, arg) => sum + countNodes(arg), 0);
    case "variable":
```

Run `npm test`. All 8 new tests fail. Most just show `actual: []`, meaning nothing was
printed. The "parameters are local" test shows the real reason:
`"[2:5] Error at 'fn': Expect expression."`. The scanner already knows the keyword `fn`, but
the parser doesn't, so it tries to read `fn` as the start of an expression.

Now run `npm run typecheck`:

```
test/ast.test.ts(17,10): error TS2678: Type '"call"' is not comparable to type '"assign" | "binary" | "grouping" | "literal" | "logical" | "unary" | "variable"'.
test/ast.test.ts(18,34): error TS2339: Property 'callee' does not exist on type 'never'.
```

It then reports a few more errors that follow from the first one. At runtime the new `case` is just dead code, so the AST test still passes. `tsc` knows
`"call"` isn't one of the kinds yet. Two different tools, two different kinds of red.

## The code

### AST: `src/ast.ts`

Add `CallExpr` right after `LogicalExpr`:

```ts
export interface CallExpr {
  readonly kind: "call";
  readonly callee: Expr;
  /** The closing ')' — used to report errors at the call site. */
  readonly paren: Token;
  readonly args: readonly Expr[];
}
```

The callee is any expression, not just a name. That's what makes `f(1)(2)` and later
`makeCounter()()` possible. `paren` exists only for error positions: a runtime error needs a
token to point at, and the `)` is the one token every call has.

Add it to the `Expr` union, after `LogicalExpr`:

```ts
export type Expr =
  | LiteralExpr
  | GroupingExpr
  | UnaryExpr
  | BinaryExpr
  | LogicalExpr
  | CallExpr
  | VariableExpr
  | AssignExpr;
```

Add `FunctionStmt` right after `WhileStmt`:

```ts
export interface FunctionStmt {
  readonly kind: "function";
  readonly name: Token;
  readonly params: readonly Token[];
  readonly body: readonly Stmt[];
}
```

`body` is a list of statements rather than a `BlockStmt`. The function sets up its own
environment for the body, so it doesn't want the block to create another one.

And extend `Stmt`:

```ts
export type Stmt =
  | ExpressionStmt
  | PrintStmt
  | LetStmt
  | BlockStmt
  | IfStmt
  | WhileStmt
  | FunctionStmt;
```

Run `npm run typecheck`. The `ast.test.ts` errors are gone, and three new ones appear, one
for each exhaustive switch that just lost its exhaustiveness:

```
src/interpreter.ts(53,21): error TS2345: Argument of type 'FunctionStmt' is not assignable to parameter of type 'never'.
src/interpreter.ts(89,28): error TS2345: Argument of type 'CallExpr' is not assignable to parameter of type 'never'.
src/printer.ts(20,26): error TS2345: Argument of type 'CallExpr' is not assignable to parameter of type 'never'.
```

That's your to-do list.

### Printer: `src/printer.ts`

Add a case to `printExpr`, right after the `binary`/`logical` case:

```ts
    case "call":
      return parenthesize("call", expr.callee, ...expr.args);
```

`parenthesize` takes rest parameters, so you spread the argument list into it.
`f(1, 2)` prints as `(call f 1 2)`.

### Parser: `src/parser.ts`

Update the AST import at the top:

```ts
import type { Expr, FunctionStmt, Stmt } from "./ast.ts";
```

In `declaration()`, check for `fn` first:

```ts
  private declaration(): Stmt {
    if (this.match("fn")) return this.functionDeclaration();
    if (this.match("let")) return this.letDeclaration();
    return this.statement();
  }
```

Add `functionDeclaration()` right after `declaration()`:

```ts
  private functionDeclaration(): FunctionStmt {
    const name = this.consume("identifier", "Expect function name.");
    this.consume("(", "Expect '(' after function name.");
    const params: Token[] = [];
    if (!this.check(")")) {
      do {
        params.push(this.consume("identifier", "Expect parameter name."));
      } while (this.match(","));
    }
    this.consume(")", "Expect ')' after parameters.");
    this.consume("{", "Expect '{' before function body.");
    const body = this.block();
    return { kind: "function", name, params, body };
  }
```

The parameter list is a pattern you'll see again for arguments. If the list isn't empty,
read one item, then keep reading while the next token is a comma. `do … while` fits exactly:
the body runs at least once, and the condition (`match(",")`) is checked after each item. It
also consumes the comma, so the next loop iteration starts at the next item.

`block()` is the same method `{ … }` blocks use. It expects the `{` to be consumed already
and consumes the `}`.

The return type is `FunctionStmt`, not `Stmt`. It's more precise, and still fine to return
from `declaration()` because a `FunctionStmt` *is* a `Stmt`.

Now calls. A call binds tighter than unary minus: `-f(1)` means `-(f(1))`. So it sits
between `unary` and `primary`. In `unary()`, change the last line from `return this.primary();`
to:

```ts
    return this.call();
```

Then add these two methods right after `unary()`:

```ts
  private call(): Expr {
    let expr = this.primary();
    while (this.match("(")) {
      expr = this.finishCall(expr);
    }
    return expr;
  }

  private finishCall(callee: Expr): Expr {
    const args: Expr[] = [];
    if (!this.check(")")) {
      do {
        args.push(this.expression());
      } while (this.match(","));
    }
    const paren = this.consume(")", "Expect ')' after arguments.");
    return { kind: "call", callee, paren, args };
  }
```

Calls are a **postfix loop**. Parse a primary, then as long as a `(` follows, wrap what you
have so far in a call. `f(1)(2)` becomes a call whose callee is the call `f(1)`. It's the
same shape as the `while` loops in `term()` and `factor()`: a loop that keeps wrapping the
left side.

`paren` is the result of the last `consume`, so it's the `)` token.

### Values: `src/function.ts`

Create the file:

```ts
import type { FunctionStmt } from "./ast.ts";
import { Environment } from "./environment.ts";
import type { Interpreter } from "./interpreter.ts";
import type { Value } from "./value.ts";

export class WyrmFunction {
  readonly kind = "function";
  private readonly declaration: FunctionStmt;

  constructor(declaration: FunctionStmt) {
    this.declaration = declaration;
  }

  get arity(): number {
    return this.declaration.params.length;
  }

  call(interpreter: Interpreter, args: readonly Value[]): Value {
    const environment = new Environment(interpreter.globals);
    this.declaration.params.forEach((param, i) => {
      environment.define(param, args[i] ?? null);
    });
    interpreter.executeBlock(this.declaration.body, environment);
    return null;
  }

  toString(): string {
    return `<fn ${this.declaration.name.lexeme}>`;
  }
}
```

Three of the four imports are `import type`. Only `Environment` is used as a value
(`new Environment(...)`), so it's the only import that survives stripping.

What `call` does:

1. It makes a fresh environment for this one call. Every call gets its own, which is why the
   same function can call itself recursively without the calls overwriting each other's `n`.
2. It binds each parameter token to its argument. `define` takes the token, so a runtime
   error in there points at the parameter.
3. It runs the body with `executeBlock`, the method from lesson 14 that swaps the
   interpreter's current environment and restores it in a `finally`.
4. It returns `nil`, because there's no `return` statement yet.

The parent of the new environment is `interpreter.globals`. **This is deliberately wrong.**
It works for every function declared at the top level, which is all you've written so far.
Keep it in mind. In lesson 19 a test will fail because of this line.

`toString()` is what makes `print f;` show `<fn roar>`: `stringify` falls back to
`String(value)`, and `String()` calls `toString()` on objects.

### Values: `src/value.ts`

Replace the first line:

```ts
export type Value = number | string | boolean | null;
```

with:

```ts
import type { WyrmFunction } from "./function.ts";

export type Callable = WyrmFunction;

export type Value = number | string | boolean | null | Callable;
```

`Callable` is a separate name even though it has only one member today. The glossary says a
callable is "a wyrm function or a native function". In lesson 20 the alias grows, and nothing
that uses the name has to change.

### Interpreter: `src/interpreter.ts`

Update the imports. Add `CallExpr` to the AST import, and import `WyrmFunction`. This one is
a value import, since the interpreter constructs functions at runtime:

```ts
import type { BinaryExpr, CallExpr, Expr, LogicalExpr, Stmt, UnaryExpr } from "./ast.ts";
import { assertNever } from "./assert-never.ts";
import { Environment } from "./environment.ts";
import { WyrmFunction } from "./function.ts";
import { assertNumber, RuntimeError } from "./runtime-error.ts";
import { isEqual, isTruthy, stringify, type Value } from "./value.ts";
```

In `execute`, add a case right after `"while"`, before `default`:

```ts
      case "function":
        this.environment.define(stmt.name, new WyrmFunction(stmt));
        return;
```

Declaring a function is just defining a variable whose value is a function. It goes into
the *current* environment, so a `fn` inside a block is local to that block, like a `let`.

In `evaluate`, add a case after `"logical"`:

```ts
      case "call":
        return this.call(expr);
```

Add the `call` method right after `evaluate`:

```ts
  private call(expr: CallExpr): Value {
    const callee = this.evaluate(expr.callee);
    const args = expr.args.map((arg) => this.evaluate(arg));

    if (typeof callee !== "object" || callee === null) {
      throw new RuntimeError(expr.paren, "Can only call functions.");
    }
    if (args.length !== callee.arity) {
      throw new RuntimeError(
        expr.paren,
        `Expected ${callee.arity} arguments but got ${args.length}.`,
      );
    }
    return callee.call(this, args);
  }
```

The order is deliberate: evaluate the callee, then the arguments left to right, and only then
check. After the first `if`, hover over `callee` in your editor. It's `WyrmFunction`. The two
`typeof`/`null` checks removed every other member of `Value`, so `.arity` and `.call` are
allowed.

`callee.call(this, args)` passes the interpreter itself. That's why `function.ts` needs
`Interpreter` as a type: it receives one and uses its `globals` and `executeBlock`.

Run `npm run check`.

## What you should see

`tsc` prints nothing, then all tests pass:

```
ℹ tests 77
ℹ pass 77
ℹ fail 0
```

Try the AST printer on a curried call:

```sh
node src/ast-cli.ts "f(1)(2)"
```

```
(call (call f 1) 2)
```

Commit:

```sh
git add -A
git commit -m "Add function declarations and calls"
```

## Study Drills

1. In `interpreter.ts`, delete `|| callee === null` from the guard in `call`. Run
   `npm run typecheck` and read all three errors. Which member of `Value` got through, and
   why does `typeof` let it in? Then undo it.
2. In `function.ts`, change `import type { FunctionStmt }` to `import { FunctionStmt }`. Run
   `npm run typecheck`, then `npm test`. One gives error TS1484 and the other a
   `SyntaxError: ... does not provide an export named 'FunctionStmt'`. Explain why the
   runtime error happens even though `ast.ts` clearly exports that name. Then undo it.
3. Now change `import type { Interpreter }` in `function.ts` to a plain import. Both `tsc`
   and the tests still pass, even though there's now a real runtime cycle between
   `interpreter.ts` and `function.ts`. Using the `a.ts`/`b.ts` example from Concepts, explain
   why this cycle happens not to crash, and what one-line change to `function.ts` would make
   it crash. (You can try it.) Then undo everything.
4. Predict the error for `f(1,);` and for `fn f(a,) {}` (message, and which token it's
   reported at). Check with a quick test or with `node src/ast-cli.ts`. Then remove anything
   you added.
5. Run this program through a temporary test:
   `fn outer() { let x = 1; fn inner() { print x; } inner(); } outer();`. It fails. Write
   down which line of `function.ts` you think is responsible and why. Don't fix it: that's
   lesson 19. Remove the test.
6. In your own words: why is `arity` a getter and not a `readonly arity: number` field set in
   the constructor? What would you have to keep in sync if it were a field?

## Checkpoint

Tell Claude: **"lesson 17 done"**. Expect questions like: *Why does `readonly kind =
"function"` have type `"function"` but `kind = "function"` has type `string`? Why is a
cycle of `import type`s harmless at runtime? Why is `?? null` correct here and `|| null`
wrong? Why does `f(1)(2)` parse without any special case?*
