# Lesson 23 — Resolver (capstone)

## Goal

wyrm has a scoping bug, and it has had it since lesson 19. Start the REPL (`npm run wyrm`) and
type this as **one line**:

```
let a = "global"; { fn show() { print a; } show(); let a = "block"; show(); }
```

It prints:

```
global
block
```

The same function, with the same `print a`, printed two different things, just because a
variable was declared *after* the function. In a language with proper lexical scope, where a
name refers to what's visible *at that spot in the source text*, both calls print `global`.

In this lesson you add a **resolver**: a pass between parsing and running that works out,
for every variable use, exactly which declaration it refers to. It fixes the bug, and as a
bonus it catches several mistakes *before* the program runs. This is the last piece of wyrm.

## Concepts

### Why it happens: an environment diagram

Walk through the program with the environments from lesson 14 and the closures from lesson 19.
Arrows point to the enclosing environment.

When `show` is declared, it captures the environment it was declared in, the block's:

```
globals  { a: "global", clock, len, str, sqrt }
   ▲
block    { show: <fn show> }                  ◄── show's closure
```

**First call.** Calling `show` creates a fresh environment for its parameters (none), whose
parent is the closure. `print a` searches upward:

```
globals  { a: "global", … }          ③ found: "global"
   ▲
block    { show }                    ② not here
   ▲
call #1  { }                         ① not here
```

Then `let a = "block";` runs, and adds `a` to **the same block environment object**:

```
globals  { a: "global", … }
   ▲
block    { show, a: "block" }        ◄── show's closure (the same object)
```

**Second call.** Same search, different answer:

```
block    { show, a: "block" }        ② found: "block"
   ▲
call #2  { }                         ① not here
```

The closure didn't take a snapshot. It holds a reference to a living environment (object
identity, lesson 19), and that environment changed. The interpreter looks names up *at the
moment they're used*, walking the chain until it finds a match. What it should do is use the
declaration that was visible *where the name was written*. For `print a` inside `show`, that's
the global `a`, because at that point in the text, the block's `a` doesn't exist yet.

### The fix: resolve once, before running

The source text never changes, so where each name points can be worked out *once*, by reading
the AST without running it. That's **static analysis**. The resolver walks the whole tree,
keeping track of which names each scope declares, and records one number per variable use:
**how many scopes up** its declaration lives.

```
fn makeCounter() {        // scope A: { count, inc }
  let count = 0;
  fn inc() {              // scope B: { }
    count = count + 1;    // `count` is 1 scope up from B
    return count;         // 1 again
  }
  return inc;             // `inc` is 0 scopes up: right here in A
}
```

At runtime, the interpreter then skips the search entirely. "1 up" means "go to the enclosing
environment once and read `count` there". If a name isn't found in any local scope, it's
treated as a **global**.

For the buggy program, the resolver visits `fn show` *before* `let a = "block"`, so when it
resolves `print a`, the block has no `a` yet. It records nothing, which means "global". Both
calls now print `global`.

### A `Map` keyed by objects

Where do you store "this use of `a` is 1 scope up"? You can't key it by the *name*: the same
name appears in many places and means different things in each. You can't key it by line and
column either, because that's clumsy and two REPL lines can share a position. Key it by the
**AST node itself**:

```ts
const seen = new Map<object, string>();
const p = { x: 1 };
const q = { x: 1 };
seen.set(p, "first");
seen.get(p); // "first"
seen.get(q); // undefined: equal contents, but a different object
```

A `Map` compares object keys by **identity**, the same `===` you met in lesson 19. Every
`VariableExpr` the parser creates is its own object, so every use of a name gets its own entry.
In wyrm:

```ts
export type Locals = Map<VariableExpr | AssignExpr, number>;
```

Those are the two node kinds that mention a variable by name: reading (`a`) and assigning
(`a = 1`). A node that's *missing* from the map is a global.

### A stack of scopes: `Map<string, boolean>[]`

The resolver keeps one `Map` per open scope, innermost last. Entering a block or a function
body pushes a map, and leaving it pops. To find the current scope, use `.at(-1)`, which means
"the last element":

```ts
const stack: string[] = ["outer", "inner"];
const top = stack.at(-1); // type: string | undefined
top?.toUpperCase();       // the stack might be empty, so handle that
```

`.at()` always returns `T | undefined`, with or without `noUncheckedIndexedAccess`, because
it can't know the array isn't empty. An empty stack is normal here: it means "we're at the top
level". Top-level names are globals, and globals aren't tracked, so "no current scope" simply
means "nothing to record". Optional chaining (`?.`) says that in one character.

### Declare vs. define

Look at this:

```
let a = "outer";
{
  let a = a;
}
```

Which `a` does the initializer read? It's almost certainly a mistake, so wyrm reports it. To
spot it, the resolver adds a name in **two steps**:

1. **Declare**: put the name in the current scope with the value `false`, meaning "declared
   but not initialized yet".
2. Resolve the initializer.
3. **Define**: set it to `true`, meaning "ready to use".

If, while resolving an initializer, you see a variable whose entry in the *current* scope is
`false`, it's being read in its own initializer. That's what the `boolean` in
`Map<string, boolean>` is for.

Declaring is also where redeclaration is caught: if the name is already in the current scope,
that's an error. Before this lesson, wyrm only noticed at runtime, *after* running everything
before it.

### Tracking the function context

`return` only makes sense inside a function. The resolver remembers whether it's currently
inside one:

```ts
type FunctionContext = "none" | "function";
```

It's a union of string literals, not a `boolean`, so it can grow. With classes, you'd add
`"method"`. When the resolver enters a function body, it **saves** the old value, sets
`"function"`, resolves the body, and **restores** the old value. Saving and restoring (rather
than setting it back to `"none"`) is what makes nested functions work.

In lesson 18, a top-level `return` quietly stopped the program. That's now a syntax error,
reported before anything runs.

### `let environment: Environment = this`

To go "n scopes up", `Environment` walks its `enclosing` chain:

```ts
let environment: Environment = this;
```

Why the annotation? Without it, TypeScript infers the type of `environment` as **`this`**, a
special type that means "whatever subclass this object really is". `environment.enclosing` is
a plain `Environment`, which might *not* be that subclass, so assigning it later is an error.
Annotating the variable as `Environment` says "any environment will do", which is what you
mean. You'll see the exact error in the drills.

### Sidebar: why `declareName`, not `declare`

The natural names for the two resolver methods are `declare` and `define`. In wyrm they're
`declareName` and `defineName`, because of a real trap.

TypeScript has a `declare` modifier for class fields (`declare foo: string;`, meaning "this
field exists, but don't emit anything for it"). When Node's type stripper sees
`private declare(name: Token)`, it misreads `declare` as that modifier and doesn't strip the
line properly. The result:

- `npm run typecheck` is **perfectly happy**. `tsc` parses it correctly as a method named
  `declare`.
- `npm test` fails when Node *loads* the file:

  ```
  private declare(name       )       {
          ^^^^^^^
  SyntaxError: Unexpected identifier 'declare'
  ```

(The spaces are where the type annotations used to be. The stripper replaces types with
spaces so that line and column numbers stay correct.)

This is the edge case ADR 0001 warns about: **the stripper is not the compiler**. Most of the
time they agree. When they don't, the error message comes from V8 and it will look like
nonsense until you remember that there are two different parsers reading your file.

## Tests first

Create `test/resolver.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./helpers.ts";

test("a closure keeps seeing the variable it closed over", () => {
  const source = `
    let a = "global";
    {
      fn show() { print a; }
      show();
      let a = "block";
      show();
    }
  `;
  assert.deepEqual(run(source), { output: ["global", "global"], errors: [] });
});

test("reading a local in its own initializer", () => {
  assert.deepEqual(run('let a = "outer"; { let a = a; }').errors, [
    "[1:28] Error at 'a': Can't read local variable in its own initializer.",
  ]);
});

test("return at top level", () => {
  assert.deepEqual(run("return 1;").errors, [
    "[1:1] Error at 'return': Can't return from top-level code.",
  ]);
});

test("duplicate local caught before running anything", () => {
  assert.deepEqual(run('print "never"; { let a = 1; let a = 2; }'), {
    output: [],
    errors: ["[1:33] Error at 'a': Already a variable with this name in this scope."],
  });
});

test("duplicate parameters", () => {
  assert.deepEqual(run("fn f(a, a) {}").errors, [
    "[1:9] Error at 'a': Already a variable with this name in this scope.",
  ]);
});

test("everything still works: recursion, closures, globals", () => {
  const source = `
    fn fib(n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }
    fn makeCounter() {
      let count = 0;
      fn inc() { count = count + 1; return count; }
      return inc;
    }
    let c = makeCounter();
    c();
    print c();
    print fib(15);
  `;
  assert.deepEqual(run(source).output, ["2", "610"]);
});
```

Run both:

```sh
npm test
npm run typecheck
```

`tsc` is happy, because the test only uses `run`, which already exists. `npm test` reports
`tests 108`, `pass 97`, `fail 5`. Read each failure. They're the bugs and gaps you're about to
fix:

- **the closure test**: `actual` has `'block'` where `'global'` was expected. That's the bug
  from the Goal.
- **own initializer**: no errors at all. The inner `a = a` quietly read the *outer* `a`.
- **top-level return**: no errors. The program just stopped (lesson 18's behaviour).
- **duplicate local**: `output` is `['never']`, and the error is a *runtime* error:
  `Variable 'a' is already declared in this scope.` The program ran partway before noticing.
- **duplicate parameters**: no errors, because `f` is never called, so the runtime check never
  runs.

The last test already passes. It's there to prove that the resolver doesn't break recursion,
closures, or globals. A capstone that fixes one thing and breaks three would be no capstone.

## The code

### `src/resolver.ts`

A new file:

```ts
import type { AssignExpr, Expr, FunctionStmt, Stmt, VariableExpr } from "./ast.ts";
import { assertNever } from "./assert-never.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { err, ok, type Result } from "./result.ts";
import type { Token } from "./token.ts";

/** For each local variable use, how many scopes up its declaration lives. */
export type Locals = Map<VariableExpr | AssignExpr, number>;

type FunctionContext = "none" | "function";

export function resolve(statements: readonly Stmt[]): Result<Locals, Diagnostic[]> {
  const resolver = new Resolver();
  resolver.resolveAll(statements);
  return resolver.errors.length > 0 ? err(resolver.errors) : ok(resolver.locals);
}

class Resolver {
  readonly locals: Locals = new Map();
  readonly errors: Diagnostic[] = [];

  /** Innermost scope last. `false` = declared but not yet initialized. Globals are not tracked. */
  private readonly scopes: Map<string, boolean>[] = [];
  private currentFunction: FunctionContext = "none";

  resolveAll(statements: readonly Stmt[]): void {
    for (const statement of statements) this.statement(statement);
  }

  private statement(stmt: Stmt): void {
    switch (stmt.kind) {
      case "expression":
      case "print":
        this.expression(stmt.expression);
        return;
      case "let":
        this.declareName(stmt.name);
        if (stmt.initializer !== null) this.expression(stmt.initializer);
        this.defineName(stmt.name);
        return;
      case "block":
        this.beginScope();
        this.resolveAll(stmt.statements);
        this.endScope();
        return;
      case "if":
        this.expression(stmt.condition);
        this.statement(stmt.thenBranch);
        if (stmt.elseBranch !== null) this.statement(stmt.elseBranch);
        return;
      case "while":
        this.expression(stmt.condition);
        this.statement(stmt.body);
        return;
      case "function":
        this.declareName(stmt.name);
        this.defineName(stmt.name); // defined before the body, so it can call itself
        this.function(stmt, "function");
        return;
      case "return":
        if (this.currentFunction === "none") {
          this.error(stmt.keyword, "Can't return from top-level code.");
        }
        if (stmt.value !== null) this.expression(stmt.value);
        return;
      default:
        assertNever(stmt);
    }
  }

  private expression(expr: Expr): void {
    switch (expr.kind) {
      case "literal":
        return;
      case "grouping":
        this.expression(expr.expression);
        return;
      case "unary":
        this.expression(expr.right);
        return;
      case "binary":
      case "logical":
        this.expression(expr.left);
        this.expression(expr.right);
        return;
      case "call":
        this.expression(expr.callee);
        for (const arg of expr.args) this.expression(arg);
        return;
      case "variable":
        if (this.scopes.at(-1)?.get(expr.name.lexeme) === false) {
          this.error(expr.name, "Can't read local variable in its own initializer.");
        }
        this.resolveLocal(expr, expr.name);
        return;
      case "assign":
        this.expression(expr.value);
        this.resolveLocal(expr, expr.name);
        return;
      default:
        assertNever(expr);
    }
  }

  private function(fn: FunctionStmt, context: FunctionContext): void {
    const enclosing = this.currentFunction;
    this.currentFunction = context;
    this.beginScope();
    for (const param of fn.params) {
      this.declareName(param);
      this.defineName(param);
    }
    this.resolveAll(fn.body);
    this.endScope();
    this.currentFunction = enclosing;
  }

  private resolveLocal(expr: VariableExpr | AssignExpr, name: Token): void {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i]?.has(name.lexeme)) {
        this.locals.set(expr, this.scopes.length - 1 - i);
        return;
      }
    }
    // Not found in any local scope: assume it's a global.
  }

  private beginScope(): void {
    this.scopes.push(new Map());
  }

  private endScope(): void {
    this.scopes.pop();
  }

  private declareName(name: Token): void {
    const scope = this.scopes.at(-1);
    if (scope === undefined) return;
    if (scope.has(name.lexeme)) {
      this.error(name, "Already a variable with this name in this scope.");
    }
    scope.set(name.lexeme, false);
  }

  private defineName(name: Token): void {
    this.scopes.at(-1)?.set(name.lexeme, true);
  }

  private error(token: Token, message: string): void {
    this.errors.push({ line: token.line, col: token.col, message, at: `'${token.lexeme}'` });
  }
}
```

Now read it in pieces.

**The front door.** `resolve` is the only export besides `Locals`. It returns the same
`Result<T, E>` as `scan` and `parse` (lesson 03), so `runSource` can treat all three stages
alike. The `Resolver` class isn't exported: it's an implementation detail with mutable state.

**The two walkers.** `statement` and `expression` have the same shape as the interpreter's
`execute` and `evaluate`: a `switch` on `kind`, with `assertNever` in the `default` so that a
new AST node kind can't be forgotten. The difference is that they visit **every** branch.
An `if` resolves both branches, and a `while` body is resolved once, not once per iteration.
The resolver doesn't care which branch *would* run. It cares what every name *means*.

**`let`.** Declare, resolve the initializer, define. That order is what makes
`{ let a = a; }` detectable (Concepts).

**`block`.** Push a scope, resolve its statements, pop. This mirrors the interpreter creating
a new `Environment` for a block, and it **has to**: the distances only work if the resolver's
scopes line up one-to-one with the interpreter's environments.

**`function`.** The name is declared *and* defined before the body is resolved, so the body can
refer to the function itself (recursion). Then `function()` resolves the body in a new scope
that holds the parameters. The interpreter does the same: one environment per call, holding the
parameters, and the body's statements run directly in it (look at `WyrmFunction.call`). Scopes
and environments line up again.

**`return`.** Report the error if we're not inside a function, but still resolve the value, so
any mistakes inside it get reported too.

**`variable`.** `this.scopes.at(-1)?.get(…) === false` reads as: "is there a current scope,
and does it say this name is declared but not yet defined?" If there's no scope, `?.` gives
`undefined`, which isn't `false`, so there's no error. Note the `=== false`: `get` returns
`boolean | undefined`, and only the exact value `false` means "mid-initializer".

**`resolveLocal`.** Search from the innermost scope (`scopes.length - 1`) outward. The first
scope that has the name wins, and the distance is how many steps outward that took. The
`?.` on `this.scopes[i]` is for `noUncheckedIndexedAccess`: you know `i` is in range, but
the compiler doesn't, and `?.` is cheaper than arguing. If no scope has the name, nothing is
recorded, which means "global".

**`declareName`.** At the top level (`scope === undefined`), return: globals aren't tracked.
Otherwise, a name already in this scope is a redeclaration. Note that it reports the error and
*keeps going*, so one run can report several diagnostics, just like the parser.

**`error`.** Builds a `Diagnostic` in the same shape the parser uses, so `formatDiagnostic`
prints `Error at 'a': …` with no changes.

### `src/environment.ts`: jumping n levels up

Add these three methods at the end of the class, after `assign`:

```ts

  getAt(distance: number, name: Token): Value {
    const value = this.ancestor(distance).values.get(name.lexeme);
    if (value === undefined) {
      throw new RuntimeError(name, `Undefined variable '${name.lexeme}'.`);
    }
    return value;
  }

  assignAt(distance: number, name: Token, value: Value): void {
    this.ancestor(distance).values.set(name.lexeme, value);
  }

  private ancestor(distance: number): Environment {
    let environment: Environment = this;
    for (let i = 0; i < distance; i++) {
      if (environment.enclosing === null) {
        throw new Error(`Resolver bug: no environment ${distance} levels up.`);
      }
      environment = environment.enclosing;
    }
    return environment;
  }
```

- `this.ancestor(distance).values` reads the `private` field of *another* `Environment`
  object. That's allowed: in TypeScript, `private` means "only code inside this class", not
  "only this object".
- `getAt` goes to exactly one environment and looks in exactly one map, with no search up the
  chain. `values.get` returns `undefined` for a missing key (wyrm's `nil` is stored as `null`,
  so the two can't be confused). With a correct resolver, the name should always be there. The
  check keeps the compiler honest and turns a surprise into a readable error.
- `assignAt` doesn't check whether the name exists: the resolver only records a distance when
  it found the declaration.
- `ancestor` throws a plain `Error`, not a `RuntimeError`. Running out of environments isn't
  a mistake in the *wyrm program*. It's a bug in *your TypeScript*. Remember `guard` from
  lesson 21: it only catches `RuntimeError` and lets everything else crash loudly. That's
  exactly what you want for a "this can't happen" bug.

### `src/interpreter.ts`: using the answers

**Imports.** The interpreter now needs the `AssignExpr` and `VariableExpr` node types, and
the `Locals` type. Find the first line:

```ts
import type { BinaryExpr, CallExpr, Expr, LogicalExpr, Stmt, UnaryExpr } from "./ast.ts";
```

Replace it with (it got too long for one line):

```ts
import type {
  AssignExpr,
  BinaryExpr,
  CallExpr,
  Expr,
  LogicalExpr,
  Stmt,
  UnaryExpr,
  VariableExpr,
} from "./ast.ts";
```

Then add this line right after the `import { NATIVES, NativeError } from "./native.ts";`
line:

```ts
import type { Locals } from "./resolver.ts";
```

**A field.** Add the `locals` field after `private environment = this.globals;`:

```ts
  readonly globals = new Environment();
  private environment = this.globals;
  private readonly locals: Locals = new Map();
```

**`resolve`.** Add this method right after the constructor, before `interpret`:

```ts
  /** Remember the resolver's answers. Called before `interpret`. */
  resolve(locals: Locals): void {
    for (const [expr, distance] of locals) this.locals.set(expr, distance);
  }
```

It *adds* entries instead of replacing the map. Why? The REPL. Each line is resolved on its
own, but a function declared three lines ago still runs later, and its body's nodes need their
distances to still be there. Iterating a `Map` with `for … of` gives `[key, value]` pairs,
which is why you can destructure them.

**`evaluate`.** In `evaluate`, find the `"variable"` and `"assign"` cases:

```ts
      case "variable":
        return this.environment.get(expr.name);
      case "assign": {
        const value = this.evaluate(expr.value);
        this.environment.assign(expr.name, value);
        return value;
      }
```

Replace them with:

```ts
      case "variable":
        return this.lookUp(expr);
      case "assign": {
        const value = this.evaluate(expr.value);
        this.assignVariable(expr, value);
        return value;
      }
```

**`lookUp` and `assignVariable`.** Add these right after `evaluate`, before `call`:

```ts
  private lookUp(expr: VariableExpr): Value {
    const distance = this.locals.get(expr);
    return distance === undefined
      ? this.globals.get(expr.name)
      : this.environment.getAt(distance, expr.name);
  }

  private assignVariable(expr: AssignExpr, value: Value): void {
    const distance = this.locals.get(expr);
    if (distance === undefined) {
      this.globals.assign(expr.name, value);
    } else {
      this.environment.assignAt(distance, expr.name, value);
    }
  }
```

This is where the bug dies. No entry in `locals` means global, so the interpreter goes
**straight to `this.globals`**. It no longer walks up from the current environment, where it
might bump into a block's `a` that was declared later. Inside `evaluate`, TypeScript has
already narrowed `expr` to `VariableExpr` or `AssignExpr` in those cases, so passing it to
these methods type-checks.

The old `get` and `assign` that walk the chain are still used, now only on `globals`, which
has no enclosing environment, so the walk is at most one step.

### `src/wyrm.ts`: wiring it in

Add the import, after the `parser.ts` import:

```ts
import { parse, parseExpression } from "./parser.ts";
import { resolve } from "./resolver.ts";
import { RuntimeError } from "./runtime-error.ts";
```

In `runSource`, add three lines between parsing and running:

```ts
  const parsed = parse(scanned.value);
  if (!parsed.ok) return { kind: "syntax-error", diagnostics: parsed.error };
  const resolved = resolve(parsed.value);
  if (!resolved.ok) return { kind: "syntax-error", diagnostics: resolved.error };
  interpreter.resolve(resolved.value);
  return guard(() => interpreter.interpret(parsed.value));
```

Resolver diagnostics are **syntax errors**, as the glossary says: *any* diagnostic means the
program doesn't run at all. So the REPL shows them like parse errors, and the file runner
exits with 65 and shows the excerpt, with no changes to either.

That also settles lesson 18's loose end. A top-level `return` used to silently stop the
program. Now it never gets that far. Make a file `/tmp/ret.wyrm` (outside the project) with
`print "a";` on line 1 and `return;` on line 2, and run it:

```
$ npm run wyrm -- /tmp/ret.wyrm
[2:1] Error at 'return': Can't return from top-level code.
  2 | return;
    | ^
```

The check in `interpret` that stops on a `"return"` completion is still there, but no program
that passed the resolver can reach it any more.

### Run the bug again

Start the REPL and type the one-liner from the Goal. You should now see `global` twice.

## What you should see

`npm run check`: `tsc` prints nothing, then:

```
ℹ tests 108
ℹ pass 108
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Add a resolver pass"
```

## Study Drills

1. **Break it on purpose (the sidebar).** Rename `declareName` to `declare` everywhere in
   `resolver.ts` (the method and its three calls). Run `npm run typecheck`: clean. Run
   `npm test`: read the error, and notice *how many* test files fail, not just
   `resolver.test.ts`. Why does a bug in one file break tests that never mention the
   resolver? Follow the imports. Then undo it and confirm `npm run check` is green.
2. **Break it on purpose.** Remove the `: Environment` annotation in `ancestor`. Read the whole
   `tsc` error, both lines, and connect it to the Concepts section. Undo it. Then comment out
   the `interpreter.resolve(…)` line in `runSource`, run `npm test`, and explain why tests about
   closures, recursion, and shadowing fail, but tests with only globals still pass. Undo it.
3. **Optional extension.** On a new git branch, make the resolver report a diagnostic for a
   local variable that is declared but never read. You'll need more than a `boolean` per name.
   Decide what to track instead. Should parameters count? What about a function's own name?
   Run the whole suite and look at which *existing* tests start failing, and ask yourself
   whether those programs really deserved an error. Then switch back to your main branch (keep
   the branch or delete it) so your code matches the lesson.
4. **Explain in your own words** why the resolver doesn't track globals at all. Think of two
   cases: (a) in the REPL, a function defined on line 1 uses a global defined on line 5; (b)
   two top-level functions, `isEven` and `isOdd`, that call each other. What would go wrong
   if top-level names had to be declared before use, like locals?
5. **Write a short paragraph** (5–8 sentences): wyrm walks the AST with a `switch` over a
   discriminated union. *Crafting Interpreters* and most Java/C# compilers use the **visitor
   pattern** instead, with one `visitX` method per node class and an `accept` method on each
   node. What does each approach make easy: adding a new *pass* (like this resolver), or adding
   a new *node kind*? What does `assertNever` give you that a visitor interface also gives
   you, and how?
6. Predict the diagnostics for a file containing a block with `let a = a;`, a duplicate
   parameter, and a top-level `return`, all at once. How many errors are reported? In what
   order? Run it with the file runner to check.

## Checkpoint

Tell Claude: **"lesson 23 done"**. Expect questions like: *Why is `Locals` keyed by AST nodes
rather than by variable names? What does `false` mean in the scopes map, and which error
needs it? Why does `let environment = this` fail without an annotation? Why must the
resolver's scopes line up exactly with the interpreter's environments? Why is the resolver
method called `declareName`?*

## Where to go next

You've built a whole language: scanner, parser, tree-walking interpreter with closures, native
functions, a REPL, a file runner, and a static pass. Some directions from here:

- **More language.**
  - *`break` and `continue`*: new statements, and new members for the `Completion` union.
    It's a direct sequel to lesson 18's "control flow as data".
  - *Lists*: `[1, 2, 3]`, indexing `xs[0]`, and natives like `push` and `len`. You'll add a
    new member to `Value`, and the compiler will show you every `switch` that has to handle
    it.
  - *Classes*: `class`, `this`, methods, and constructors. The resolver's `FunctionContext`
    grows a `"method"` member, and `this` gets resolved like a variable.
- **Read *Crafting Interpreters*** by Robert Nystrom (free at craftinginterpreters.com).
  wyrm loosely follows the design of its first half, jlox: the resolver you just wrote is
  chapter 11, "Resolving and Binding". You'll recognize almost everything, and the book goes
  on to classes, inheritance, and then a bytecode virtual machine in C.
- **Type-level TypeScript.** Lesson 20's `ArgsOf` turned a tuple of type names into a tuple
  of real types. Push that idea further: build a **mini-zod**, a tiny validation library where
  you write a schema once, as values (`object({ name: string(), age: number() })`), and get
  both a runtime checker for `unknown` input and the matching static type (via
  `Infer<typeof schema>`) without ever writing the type by hand. It uses generics,
  conditional types, mapped types, and type predicates, and it has no `any` and no `as`.
