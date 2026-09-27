# Lesson 18 — return

## Goal

Add `return`. `return a + b;` hands a value back to the caller, and a bare `return;` gives
back `nil`. A `return` deep inside loops and blocks must stop *everything* between it and the
function call: the rest of the block, the loop, the enclosing `if`s.

The TypeScript idea is one of the most useful design moves in typed code: **model control
flow as data**. Instead of jumping out with an exception, every statement *reports how it
finished*, and the type system makes sure nobody forgets to produce that report.

## Concepts

### The problem: unwinding several calls at once

Look at what the interpreter's call stack looks like when `return i;` runs in this program:

```
fn firstOver(limit) {
  let i = 0;
  while (true) {
    {
      if (i * i > limit) return i;
    }
    i = i + 1;
  }
}
```

```
WyrmFunction.call          ← needs the value
  executeBlock (fn body)
    execute (while)
      execute (block)
        executeBlock
          execute (if)
            execute (return)   ← has the value
```

The value has to travel up five TypeScript calls, and each of them has to *stop what it's
doing*: the `while` must not loop again, and the block must not run its next statement. There
are two common ways to do that.

### Option A: throw it

```ts
class Return {
  readonly value: Value;
  constructor(value: Value) { this.value = value; }
}

// in execute, case "return":
throw new Return(value);

// in WyrmFunction.call:
try {
  interpreter.executeBlock(body, environment);
} catch (e) {
  if (e instanceof Return) return e.value;
  throw e;
}
return null;
```

It's short. Nothing in between has to change, because an exception flies straight past every
frame. That's exactly its weakness:

- **It's invisible.** `execute(stmt: Stmt): void` still says "returns nothing". TypeScript has
  no `throws` clause, so nothing in any signature tells you a `Return` might come flying
  out. Every `try/catch` between the `return` and the function (for example, one that catches
  errors to report them) has to remember to let `Return` through. Forget once and a `return`
  gets swallowed or reported as a crash.
- **It's slow.** Throwing is much more expensive than returning in JavaScript engines. It
  also abuses the error mechanism: `throw` means "something went wrong", and a function
  returning is the most normal thing in the world. `fib(20)` returns about 20 000 times.

### Option B: return it as data

Make every statement say how it finished:

```ts
type Completion =
  | { readonly kind: "normal" }
  | { readonly kind: "return"; readonly value: Value };
```

This is the glossary's **completion**, as a discriminated union. `execute` returns one.
Anything that runs statements in sequence checks it: on `"return"`, stop and pass it upward.

Now the control flow is **in the types**. `execute(stmt: Stmt): Completion` tells every reader
that a statement can end early. And when you change a return type from `void` to
`Completion`, the compiler flags every place that *produces* a result without making one: each
bare `return;` becomes an error. You don't have to remember where they all are.

Be precise about what the compiler does *not* check: TypeScript never complains when a caller
**ignores** a return value. `this.execute(stmt);` on its own line still compiles. So the
compiler finds the producers for you, and you find the consumers by reading the signature and
searching for `execute(` and `executeBlock(`. That's still far better than exceptions, where
neither is visible.

### A constant for the common case

Most statements complete normally. Instead of building `{ kind: "normal" }` hundreds of times,
share one object:

```ts
const NORMAL: Completion = { kind: "normal" };
```

The annotation matters. Without it, TypeScript widens the property to `kind: string` (the
object could be mutated later), and `{ kind: string }` isn't a `Completion`. With the
annotation, the literal is checked against the union right where it's written. Sharing the
object is safe because every field of `Completion` is `readonly`, so nobody can change it.

## Tests first

Append these to `test/functions.test.ts`:

```ts
test("return gives back a value", () => {
  assert.deepEqual(run("fn add(a, b) { return a + b; } print add(2, 3);").output, ["5"]);
});

test("recursive fib", () => {
  const source = `
    fn fib(n) {
      if (n < 2) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
    print fib(10);
  `;
  assert.deepEqual(run(source).output, ["55"]);
});

test("return exits loops and nested blocks immediately", () => {
  const source = `
    fn firstOver(limit) {
      let i = 0;
      while (true) {
        {
          if (i * i > limit) return i;
        }
        i = i + 1;
      }
    }
    print firstOver(50);
  `;
  assert.deepEqual(run(source).output, ["8"]);
});

test("a bare return gives nil", () => {
  assert.deepEqual(run('fn f() { return; print "unreachable"; } print f();').output, ["nil"]);
});
```

The third test is the unwinding picture from Concepts. If `return` only left the innermost
block, the `while (true)` would never end and the test would hang.

Run `npm test`. The 4 new tests fail with `actual: []`. As in lesson 17, the reason is in the
parser: the scanner already produces `return` tokens, but no statement starts with one, so
the source fails to parse (`Error at 'return': Expect expression.`) and nothing runs.
`npm run typecheck` is clean, because the tests only use `run`, which already exists.

## The code

### AST: `src/ast.ts`

Add `ReturnStmt` right after `FunctionStmt`:

```ts
export interface ReturnStmt {
  readonly kind: "return";
  readonly keyword: Token;
  readonly value: Expr | null;
}
```

`value` is `null` for a bare `return;`. `keyword` is the `return` token. Nothing uses it yet;
the resolver in lesson 23 reports errors at it.

Extend the `Stmt` union:

```ts
export type Stmt =
  | ExpressionStmt
  | PrintStmt
  | LetStmt
  | BlockStmt
  | IfStmt
  | WhileStmt
  | FunctionStmt
  | ReturnStmt;
```

`npm run typecheck` now points at `execute`'s `assertNever`:
`Argument of type 'ReturnStmt' is not assignable to parameter of type 'never'.`

### Parser: `src/parser.ts`

In `statement()`, add the `return` line after the `print` line:

```ts
  private statement(): Stmt {
    if (this.match("if")) return this.ifStatement();
    if (this.match("print")) return this.printStatement();
    if (this.match("return")) return this.returnStatement();
    if (this.match("while")) return this.whileStatement();
    if (this.match("{")) return { kind: "block", statements: this.block() };
    return this.expressionStatement();
  }
```

Add `returnStatement()` right after `ifStatement()`:

```ts
  private returnStatement(): Stmt {
    const keyword = this.previous();
    const value = this.check(";") ? null : this.expression();
    this.consume(";", "Expect ';' after return value.");
    return { kind: "return", keyword, value };
  }
```

`match` already consumed the keyword, so `previous()` is the `return` token. If the next token
is `;`, there's no value. `check` only looks at it, and `consume` eats it.

### Interpreter: `src/interpreter.ts`

Add the `Completion` type and the `NORMAL` constant right after the `Output` type:

```ts
export type Output = (line: string) => void;

/** How a statement finished: normally, or by hitting `return`. */
export type Completion =
  | { readonly kind: "normal" }
  | { readonly kind: "return"; readonly value: Value };

const NORMAL: Completion = { kind: "normal" };
```

`Completion` is exported because `function.ts` reads it. `NORMAL` isn't exported: only the
interpreter creates completions.

**Let the compiler walk you.** Before you type the new method bodies, change only the two
signatures:

```ts
  execute(stmt: Stmt): Completion {
```

```ts
  executeBlock(statements: readonly Stmt[], environment: Environment): Completion {
```

Run `npm run typecheck` (your line numbers may differ slightly):

```
src/interpreter.ts(15,7): error TS6133: 'NORMAL' is declared but its value is never read.
src/interpreter.ts(36,9): error TS2322: Type 'undefined' is not assignable to type 'Completion'.
src/interpreter.ts(39,9): error TS2322: Type 'undefined' is not assignable to type 'Completion'.
src/interpreter.ts(43,9): error TS2322: Type 'undefined' is not assignable to type 'Completion'.
src/interpreter.ts(47,9): error TS2322: Type 'undefined' is not assignable to type 'Completion'.
src/interpreter.ts(54,9): error TS2322: Type 'undefined' is not assignable to type 'Completion'.
src/interpreter.ts(59,9): error TS2322: Type 'undefined' is not assignable to type 'Completion'.
src/interpreter.ts(62,9): error TS2322: Type 'undefined' is not assignable to type 'Completion'.
src/interpreter.ts(64,21): error TS2345: Argument of type 'ReturnStmt' is not assignable to parameter of type 'never'.
src/interpreter.ts(68,72): error TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value.
```

Every bare `return;` in `execute` is flagged, and `executeBlock` is flagged for not returning
at all. Visit each one. Notice what is **not** in the list: `interpret`, the `while` body's
`this.execute(stmt.body);`, and `function.ts`. They *ignore* a completion, and ignoring a
return value is legal. You'll fix those by reading, not by compiler error.

Now replace everything from `interpret(` down to the closing brace of `executeBlock` with this
(the constructor above it and `evaluate` below it don't change):

```ts
  interpret(statements: readonly Stmt[]): void {
    for (const statement of statements) {
      const completion = this.execute(statement);
      if (completion.kind === "return") return;
    }
  }

  execute(stmt: Stmt): Completion {
    switch (stmt.kind) {
      case "expression":
        this.evaluate(stmt.expression);
        return NORMAL;
      case "print":
        this.output(stringify(this.evaluate(stmt.expression)));
        return NORMAL;
      case "let": {
        const value = stmt.initializer === null ? null : this.evaluate(stmt.initializer);
        this.environment.define(stmt.name, value);
        return NORMAL;
      }
      case "block":
        return this.executeBlock(stmt.statements, new Environment(this.environment));
      case "if":
        if (isTruthy(this.evaluate(stmt.condition))) {
          return this.execute(stmt.thenBranch);
        }
        if (stmt.elseBranch !== null) {
          return this.execute(stmt.elseBranch);
        }
        return NORMAL;
      case "while":
        while (isTruthy(this.evaluate(stmt.condition))) {
          const completion = this.execute(stmt.body);
          if (completion.kind === "return") return completion;
        }
        return NORMAL;
      case "function":
        this.environment.define(stmt.name, new WyrmFunction(stmt));
        return NORMAL;
      case "return": {
        const value = stmt.value === null ? null : this.evaluate(stmt.value);
        return { kind: "return", value };
      }
      default:
        return assertNever(stmt);
    }
  }

  executeBlock(statements: readonly Stmt[], environment: Environment): Completion {
    const previous = this.environment;
    try {
      this.environment = environment;
      for (const statement of statements) {
        const completion = this.execute(statement);
        if (completion.kind === "return") return completion;
      }
      return NORMAL;
    } finally {
      this.environment = previous;
    }
  }
```

Walk through the changes case by case:

- **Simple statements** (`expression`, `print`, `let`, `function`) do their work and return
  `NORMAL`.
- **`block`** returns whatever `executeBlock` returns. Its completion *is* the block's
  completion.
- **`if`** now has two separate `if`s instead of `else if`, because each branch returns its
  branch's completion. The final `return NORMAL` covers "condition false, no else".
- **`while`** checks after every iteration. On `"return"` it stops looping and passes the same
  completion object upward, unchanged.
- **`return`** evaluates the value (or uses `nil`) and builds the one non-normal completion.
  The object literal is checked against the declared return type `Completion`, so
  `kind: "return"` keeps its literal type. No annotation is needed here.
- **`default`** becomes `return assertNever(stmt);`. `assertNever` returns `never`, so the
  code compiles either way. Writing `return` makes it match `evaluate` and says clearly that
  this path produces the function's result.
- **`executeBlock`** returns from *inside* the `try`. The `finally` still runs, so the
  environment is restored even when a `return` leaves early. That's the same guarantee
  lesson 14 relied on for runtime errors.
- **`interpret`** stops at a top-level `return`. It has nowhere to send the value, so the
  program just ends, silently. That's odd behavior. Lesson 23's resolver turns it into a
  proper error before the program runs.

The `completion.kind === "return"` checks are narrowing on a discriminated union. After the
check, `completion.value` exists. Before it, it doesn't.

### Functions: `src/function.ts`

The last consumer. In `call`, find:

```ts
    interpreter.executeBlock(this.declaration.body, environment);
    return null;
```

Replace it with:

```ts
    const completion = interpreter.executeBlock(this.declaration.body, environment);
    return completion.kind === "return" ? completion.value : null;
```

This is where the unwinding ends. A body that runs off its end completes normally, and the
call gives back `nil`, which keeps lesson 17's "a function without return gives nil" test
green.

Run `npm run check`.

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 81
ℹ pass 81
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Add return statements"
```

## Study Drills

1. Remove the `: Completion` annotation from `const NORMAL`. Run `npm run typecheck` and read
   the first error in full, including the second line that starts `Property 'value' is
   missing…`. Explain what type `NORMAL` got and why TypeScript then checked it against the
   `"return"` member. Then undo it.
2. In `function.ts`, put back the lesson 17 version (`interpreter.executeBlock(...)` on its
   own line and `return null;`). Predict which tests fail and whether `tsc` complains. Run
   both. Then undo it. What does this tell you about the limits of "the compiler walks you
   through it"?
3. Write down, *before running anything*, what `print 1; return; print 2;` prints at the top
   level, and why. Check it with a temporary test, then delete the test.
4. Optional extension: rewrite `return` using the throwing approach from Concepts (Option A)
   on a scratch branch: `git switch -c throw-return`. Get the tests green. Then list, in
   two columns, every place you had to touch in each approach and every place that *could*
   have broken silently. Switch back to your main branch and delete the scratch branch.
5. The third test hangs forever if any link in the unwinding chain is missing. In your own
   words, name each link in the chain for `firstOver(50)` (which method, which line) and
   what it does with the completion.

## Checkpoint

Tell Claude: **"lesson 18 done"**. Expect questions like: *Why is `Completion` a
discriminated union and not a `Value | undefined`? Why does `NORMAL` need its type
annotation? Which places did `tsc` find for you, and which did it not? Why does the
environment still get restored when `return` leaves `executeBlock` early?*
