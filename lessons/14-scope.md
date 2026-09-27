# Lesson 14 — Blocks & scope

## Goal

Add blocks, `{ … }`, and give each block its own **scope**:

```
let a = "outer";
{
  let a = "inner";   // shadows the outer a
  print a;           // inner
}
print a;             // outer
```

Each scope gets its own `Environment`, linked to the one around it. By the end, the
interpreter can enter a block and always leave it cleanly, even when a runtime error blows
up in the middle.

## Concepts

### A class that refers to itself

A type can mention itself. You did it with `Expr` in lesson 05 (a `BinaryExpr` holds two
`Expr`s). Classes can too:

```ts
class Folder {
  readonly name: string;
  readonly parent: Folder | null;

  constructor(name: string, parent: Folder | null = null) {
    this.name = name;
    this.parent = parent;
  }

  path(): string {
    return this.parent === null ? this.name : `${this.parent.path()}/${this.name}`;
  }
}

const docs = new Folder("docs", new Folder("home"));
docs.path(); // "home/docs"
```

`| null` is what ends the chain. Without it you could never build the first object, since
every `Folder` would need an existing `Folder` as its parent. And because `strict` includes
null checks, TypeScript won't let you call `this.parent.path()` until you've ruled out `null`.

For wyrm, `Environment` gets an `enclosing: Environment | null`. The global environment has
`null`. Every block environment points at the one it was created inside. To look up a name,
check your own map, then ask `enclosing`, and so on outwards. If you reach `null`, the
variable doesn't exist.

```
  block env  { a: "inner" } ──enclosing──► global env { a: "outer" } ──enclosing──► null
```

### Shadowing

With a chain, the *nearest* definition wins. `print a` inside the block finds `"inner"`
first and stops looking. The outer `a` is still there, only hidden. That's **shadowing**.
It's different from **redeclaration** (two `let a` in the *same* scope), which is still an
error.

Assignment walks the chain the same way: `a = 2` inside a block changes the nearest `a` that
exists, which may be an outer one.

### `try` / `finally`

`finally` runs whether the `try` block finishes normally, returns, or throws:

```ts
function withLog(task: () => void): void {
  console.log("start");
  try {
    task();
  } finally {
    console.log("end");   // always printed, even if task() throws
  }
}
```

If `task()` throws, the error keeps travelling up *after* the `finally` block has run. So
`finally` isn't for handling errors. It's for **cleanup that must happen anyway**.

The interpreter has a field `environment`: "the scope we're executing in right now". Entering
a block swaps in a new environment. Leaving the block must swap the old one back, and a
runtime error inside the block must not skip that step. Otherwise the interpreter stays stuck
inside a scope that no longer exists. That's a textbook `finally`.

### `globals` vs. `environment`

The interpreter gets two fields:

- `globals`: the outermost environment. The field never changes, so it's `readonly`. It isn't
  `private`: reading it can't break anything. In lesson 20 the native functions go in here.
- `environment`: the *current* environment. It changes on every block entry and exit, so it
  is **not** `readonly`, and it's `private`.

At the start they're the same object: `private environment = this.globals;`. A field
initializer can use `this` and read fields declared **above** it, because initializers run in
order. Swap the two lines and `globals` would still be `undefined` when `environment` is
initialized. (`tsc` catches that: try it in the drills.)

## Tests first

### `test/scope.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Interpreter } from "../src/interpreter.ts";
import { run, runWith } from "./helpers.ts";

test("inner blocks can read outer variables", () => {
  assert.deepEqual(run("let a = 1; { print a; }").output, ["1"]);
});

test("shadowing: an inner let hides the outer one", () => {
  const source = `
    let a = "outer";
    {
      let a = "inner";
      print a;
    }
    print a;
  `;
  assert.deepEqual(run(source).output, ["inner", "outer"]);
});

test("assignment in a block changes the outer variable", () => {
  assert.deepEqual(run("let a = 1; { a = 2; } print a;").output, ["2"]);
});

test("block variables do not leak out", () => {
  assert.deepEqual(run("{ let hidden = 1; } print hidden;").errors, [
    "[1:27] Runtime error: Undefined variable 'hidden'.",
  ]);
});

test("the scope is restored even after a runtime error", () => {
  const output: string[] = [];
  const interpreter = new Interpreter((line) => output.push(line));
  assert.deepEqual(runWith(interpreter, 'let a = "global"; { let a = "local"; print -a; }'), [
    "[1:44] Runtime error: Operand must be a number.",
  ]);
  assert.deepEqual(runWith(interpreter, "print a;"), []);
  assert.deepEqual(output, ["global"]);
});

test("unclosed block", () => {
  assert.deepEqual(run("{ print 1;").errors, ["[1:11] Error at end: Expect '}' after block."]);
});
```

The fifth test is the important one. It runs **two programs on the same interpreter**:

1. The first program enters a block, declares a local `a`, and dies on `-a` (you can't negate
   a string).
2. The second program prints `a`. If the interpreter is still stuck in the dead block's
   environment, it prints `local`. If the scope was restored, it prints `global`.

`run()` can't do this, because it creates a fresh interpreter every time. So the test needs a
new helper, `runWith(interpreter, source)`.

Run `npm test`:

```
SyntaxError: The requested module './helpers.ts' does not provide an export named 'runWith'
```

This time only `scope.test.ts` fails to load. `helpers.ts` itself is fine; it just doesn't
export what the new file asks for. `npm run typecheck` says the same thing in its own words:

```
test/scope.test.ts(4,15): error TS2305: Module '"./helpers.ts"' has no exported member 'runWith'.
```

### `test/helpers.ts`: `run` delegates to `runWith`

Pull the pipeline out of `run` into `runWith`, and make `run` a thin wrapper around it.
Most of the file changes shape, so replace the whole file with:

```ts
import { formatDiagnostic, formatRuntimeError } from "../src/format.ts";
import { Interpreter } from "../src/interpreter.ts";
import { parse } from "../src/parser.ts";
import { RuntimeError } from "../src/runtime-error.ts";
import { scan } from "../src/scanner.ts";
import type { Token, TokenType } from "../src/token.ts";

export function tok(type: TokenType, lexeme: string = type): Token {
  return { type, lexeme, literal: null, line: 1, col: 1 };
}

export interface RunResult {
  readonly output: string[];
  readonly errors: string[];
}

/** Scan, parse and interpret `source`, collecting printed lines and formatted errors. */
export function run(source: string): RunResult {
  const output: string[] = [];
  const errors = runWith(new Interpreter((line) => output.push(line)), source);
  return { output, errors };
}

/** Like `run`, but reuses an existing interpreter (and its variables). Returns the errors. */
export function runWith(interpreter: Interpreter, source: string): string[] {
  const scanned = scan(source);
  if (!scanned.ok) return scanned.error.map(formatDiagnostic);
  const parsed = parse(scanned.value);
  if (!parsed.ok) return parsed.error.map(formatDiagnostic);
  try {
    interpreter.interpret(parsed.value);
    return [];
  } catch (error) {
    if (!(error instanceof RuntimeError)) throw error;
    return [formatRuntimeError(error)];
  }
}
```

What changed:

- `runWith` doesn't know where the output goes. The caller built the interpreter, so the
  caller chose the output. `runWith` only returns the errors.
- `run` builds an interpreter with an array output, hands it to `runWith`, and packs both
  into a `RunResult`. Its behaviour is exactly the same as before, which is why all 53 old
  tests still pass unchanged. That's a safe refactor: same behaviour, new shape.

Run `npm test` again. The file loads now, and all 6 scope tests fail for real reasons: the
parser doesn't know `{` yet. For example:

```
    actual: [ "[1:1] Error at '{': Expect expression." ],
    expected: [ "[1:11] Error at end: Expect '}' after block." ],
```

## The code

### `src/ast.ts`: the block statement

At the end of the file, find:

```ts
export type Stmt = ExpressionStmt | PrintStmt | LetStmt;
```

Replace it with:

```ts
export interface BlockStmt {
  readonly kind: "block";
  readonly statements: readonly Stmt[];
}

export type Stmt = ExpressionStmt | PrintStmt | LetStmt | BlockStmt;
```

`BlockStmt` contains `Stmt`s, and `Stmt` contains `BlockStmt`. The same kind of recursive type
as `Expr`.

Run `npm run typecheck`. You get a single error, from `assertNever` in `execute`: `BlockStmt`
isn't handled. The printer and `countNodes` only deal with `Expr`, so they don't care. That's
your to-do list for the interpreter. Do the environment first, though.

### `src/environment.ts`: the enclosing chain

The constructor is new and both lookups change, so replace the whole file with:

```ts
import { RuntimeError } from "./runtime-error.ts";
import type { Token } from "./token.ts";
import type { Value } from "./value.ts";

export class Environment {
  private readonly values = new Map<string, Value>();
  readonly enclosing: Environment | null;

  constructor(enclosing: Environment | null = null) {
    this.enclosing = enclosing;
  }

  define(name: Token, value: Value): void {
    if (this.values.has(name.lexeme)) {
      throw new RuntimeError(name, `Variable '${name.lexeme}' is already declared in this scope.`);
    }
    this.values.set(name.lexeme, value);
  }

  get(name: Token): Value {
    const value = this.values.get(name.lexeme);
    if (value !== undefined) return value;
    if (this.enclosing !== null) return this.enclosing.get(name);
    throw new RuntimeError(name, `Undefined variable '${name.lexeme}'.`);
  }

  assign(name: Token, value: Value): void {
    if (this.values.has(name.lexeme)) {
      this.values.set(name.lexeme, value);
      return;
    }
    if (this.enclosing !== null) {
      this.enclosing.assign(name, value);
      return;
    }
    throw new RuntimeError(name, `Undefined variable '${name.lexeme}'.`);
  }
}
```

- `enclosing` is `readonly`: an environment never changes which scope it lives in. The
  default `= null` means `new Environment()` (what the interpreter already writes) still
  creates a global environment.
- `get` now reads as three cases in order: found here, ask the parent, give up. Each
  `if (… !== null)` narrows `this.enclosing` from `Environment | null` to `Environment`, so
  the recursive call type-checks.
- `define` is unchanged. It only ever looks at **this** scope. That's what makes shadowing
  legal (`let a` in a block is a different scope from the outer `let a`) and redeclaration
  illegal (`let a` twice in one scope).
- `assign` never creates a variable. If no scope in the chain has the name, it's an error, just
  as before.

### `src/parser.ts`: parsing a block

In `statement()`, add a line for `{` after the `print` line:

```ts
  private statement(): Stmt {
    if (this.match("print")) return this.printStatement();
    if (this.match("{")) return { kind: "block", statements: this.block() };
    return this.expressionStatement();
  }
```

Then add `block()` right after `statement()`:

```ts
  private block(): Stmt[] {
    const statements: Stmt[] = [];
    while (!this.check("}") && !this.isAtEnd()) {
      statements.push(this.declaration());
    }
    this.consume("}", "Expect '}' after block.");
    return statements;
  }
```

- `block()` returns the *list*, not a `BlockStmt`. That way it can be reused later (function
  bodies in lesson 17 are blocks too).
- Inside a block you call `declaration()`, not `statement()`, so `let` is allowed there.
- `!this.isAtEnd()` stops the loop on unclosed input like `{ print 1;`. Then `consume("}")`
  reports `Expect '}' after block.` at the end of the input: that's the last test.
- A `Stmt[]` is accepted where `readonly Stmt[]` is expected. The reverse wouldn't be.

### `src/interpreter.ts`: entering and leaving scopes

Replace the environment field. Find:

```ts
  private readonly environment = new Environment();
```

Replace it with:

```ts
  readonly globals = new Environment();
  private environment = this.globals;
```

In `execute`, add a case after `"let"`, before `default`:

```ts
      case "block":
        this.executeBlock(stmt.statements, new Environment(this.environment));
        return;
```

And add `executeBlock` right after `execute`:

```ts
  executeBlock(statements: readonly Stmt[], environment: Environment): void {
    const previous = this.environment;
    try {
      this.environment = environment;
      for (const statement of statements) {
        this.execute(statement);
      }
    } finally {
      this.environment = previous;
    }
  }
```

- `new Environment(this.environment)` creates the block's scope, enclosed by whatever is
  current. Nested blocks build a longer chain.
- `executeBlock` takes the environment as a parameter instead of creating it. For a plain
  block that looks unnecessary. Lesson 17 will call it with a function's environment instead.
  It's public for the same reason.
- `previous` is saved **before** the `try`. The `finally` puts it back on every path out of
  the block. The runtime error from `-a` still propagates to `runWith`, which formats it. The
  `finally` doesn't swallow it.
- There's no `catch`. This method doesn't know what to *do* about an error, so it doesn't
  catch one. It only cleans up.

Run everything:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 59
ℹ pass 59
ℹ fail 0
```

53 from before plus the 6 in `scope.test.ts`.

Commit:

```sh
git add -A
git commit -m "Add blocks and nested scopes"
```

## Study Drills

1. **Break it on purpose.** In `executeBlock`, remove the `try {` and the whole `finally`
   part, so the body is just: save `previous`, set the environment, run the loop, restore.
   Run `npm test`. Which test fails, and what does it print instead of `global`? Explain the
   difference in one sentence. Then undo it.
2. **Break it on purpose.** In the interpreter, swap the order of the `globals` and
   `environment` field lines. Read the `tsc` error. Then undo it.
3. In `Environment.get`, delete the `this.enclosing !== null` check so it calls
   `this.enclosing.get(name)` directly. What does `tsc` say, and what would happen at runtime
   for an undefined variable if you ran it anyway? Then undo it.
4. Explain in your own words the difference between shadowing and redeclaration, and point to
   the exact line in `Environment` that makes one legal and the other an error.
5. **Small extension (then undo it).** Add a temporary test with three nested blocks, each
   shadowing `a` and printing it, and then printing it again on the way out. Predict the
   output. Draw the environment chain at the innermost `print`. Delete the test when you're
   done.

## Checkpoint

Tell Claude: **"lesson 14 done"**. Expect questions like: *Why is `enclosing` typed
`Environment | null` and not just `Environment`? What exactly goes wrong without the
`finally`, and which test proves it? Why is `globals` `readonly` but `environment` not? Why
does `define` only look at its own map while `get` walks the chain?*
