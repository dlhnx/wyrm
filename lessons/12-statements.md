# Lesson 12 — Statements & print

## Goal

Until now wyrm could evaluate exactly one expression. Real programs are a list of
**statements**: `print 1 + 2; print "wyrm";`. By the end of this lesson:

- the parser has a new entry point, `parse()`, that turns tokens into a `Stmt[]` and reports
  **every** broken statement, not just the first one;
- the interpreter can **execute** statements, and `print` writes to an **output** that you
  choose when you create the interpreter;
- the tests can run whole wyrm programs through a new helper, `run()`, and check what they
  printed.

The big TypeScript idea is small: a **function type**. The big design idea is what you do with
it: **dependency injection**.

## Concepts

### Expressions vs. statements

An expression produces a value (`1 + 2`). A statement does something and produces nothing
(`print 1 + 2;`). wyrm gets two statements today:

| Source | Statement | What it does |
|---|---|---|
| `print 1 + 2;` | print statement | evaluates the expression, writes the result to the output |
| `1 + 2;` | expression statement | evaluates the expression, throws the value away |

The expression statement looks useless now. It won't be once you have assignment
(`x = 1;`) in lesson 13 and calls (`f();`) in lesson 17.

Statements are a second discriminated union, exactly like `Expr` from lesson 05: every member
has a `kind`, and a `switch` on `kind` narrows to the right member.

### Function types

In TypeScript a function's type describes its parameters and its return type:

```ts
type Formatter = (n: number) => string;

const hex: Formatter = (n) => n.toString(16);   // n is inferred as number
const bad: Formatter = (n) => n * 2;            // error: number is not assignable to string
```

The parameter *names* in the type are documentation only. What matters is the order and the
types.

A function type that returns `void` means "I will ignore whatever you return", so a function
that happens to return something still fits:

```ts
type Listener = (event: string) => void;

const seen: string[] = [];
const onEvent: Listener = (event) => seen.push(event); // push returns a number: that's fine
```

That rule is exactly what lets a test write `(line) => output.push(line)` in a moment.

### Dependency injection

Here's a class that is hard to test:

```ts
class Greeter {
  greet(name: string): void {
    console.log(`Hello, ${name}`);   // hard-wired: the text goes to the terminal, full stop
  }
}
```

To check what it printed, a test would have to intercept `console.log`. Instead, **pass the
dependency in**:

```ts
type Sink = (text: string) => void;

class Greeter {
  private readonly sink: Sink;

  constructor(sink: Sink = console.log) {
    this.sink = sink;
  }

  greet(name: string): void {
    this.sink(`Hello, ${name}`);
  }
}

new Greeter().greet("wyrm");              // real use: terminal
const lines: string[] = [];
new Greeter((t) => lines.push(t)).greet("wyrm"); // test: lines is ["Hello, wyrm"]
```

The default parameter keeps real use as short as before. The class no longer decides where
its output goes; whoever creates it does. That's all "dependency injection" means:
**a class gets its dependencies from outside instead of reaching for globals.**

In wyrm, the dependency is the **output** (see `CONTEXT.md`): `type Output = (line: string) => void`.
The interpreter takes one in its constructor and defaults to `console.log`.

Remember that fields are declared and assigned explicitly (ADR 0001): no
`constructor(private readonly output: Output)`.

### Collecting many syntax errors: panic mode

In lesson 08 the parser threw a `ParseError` at the first problem, and `parseExpression`
turned it into `err([diagnostic])`. For a whole program, one error per run is annoying. You
fix it, run again, and find the next one.

The fix is called **panic mode**:

1. Parse one statement at a time inside a `try`.
2. If a `ParseError` comes out, record its diagnostic.
3. **Synchronize**: skip tokens until you are probably at the start of the next statement
   (just past a `;`, or right before a keyword like `print` or `let`).
4. Carry on parsing.

At the end, if any diagnostic was recorded, return `err(allOfThem)`. Otherwise
`ok(statements)`. Throwing is still how a *single* statement gives up. `Result` is how the
*whole parse* reports back. You'll use both.

### `assertNever` in a function that returns nothing

In `evaluate` you wrote `return assertNever(expr);` because `evaluate` must return a `Value`.
`execute` returns `void`, so there's nothing to return. A plain `assertNever(stmt);` is
enough. It still fails to compile if a `Stmt` member is missing a `case`, and that's the part
you care about.

## Tests first

### `test/statements.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./helpers.ts";

test("print writes one line per statement", () => {
  assert.deepEqual(run('print 1 + 2; print "wyrm"; print nil;'), {
    output: ["3", "wyrm", "nil"],
    errors: [],
  });
});

test("expression statements are evaluated but print nothing", () => {
  assert.deepEqual(run("1 + 2;"), { output: [], errors: [] });
});

test("missing semicolon", () => {
  assert.deepEqual(run("print 1"), {
    output: [],
    errors: ["[1:8] Error at end: Expect ';' after value."],
  });
});

test("the parser reports every broken statement", () => {
  assert.deepEqual(run("print (1;\nprint 2;\nprint +;").errors, [
    "[1:9] Error at ';': Expect ')' after expression.",
    "[3:7] Error at '+': Expect expression.",
  ]);
});

test("a runtime error stops the program", () => {
  assert.deepEqual(run('print 1;\nprint -"x";\nprint 3;'), {
    output: ["1"],
    errors: ["[2:7] Runtime error: Operand must be a number."],
  });
});
```

Look at the fourth test. Line 2, `print 2;`, is fine, but nothing is printed: a program with
a syntax error does not run *at all* (see "Syntax error" in `CONTEXT.md`). Compare it with the
last test: a runtime error stops the program *at that point*, and the `1` printed before it
stays printed.

### `test/helpers.ts`

The helper file grows. First, **add these import lines at the top of the file**, above the
`import type { Token, TokenType }` line that's already there:

```ts
import { formatDiagnostic, formatRuntimeError } from "../src/format.ts";
import { Interpreter } from "../src/interpreter.ts";
import { parse } from "../src/parser.ts";
import { RuntimeError } from "../src/runtime-error.ts";
import { scan } from "../src/scanner.ts";
```

Then add this at the bottom, after `tok()`:

```ts
export interface RunResult {
  readonly output: string[];
  readonly errors: string[];
}

/** Scan, parse and interpret `source`, collecting printed lines and formatted errors. */
export function run(source: string): RunResult {
  const output: string[] = [];
  const scanned = scan(source);
  if (!scanned.ok) return { output, errors: scanned.error.map(formatDiagnostic) };
  const parsed = parse(scanned.value);
  if (!parsed.ok) return { output, errors: parsed.error.map(formatDiagnostic) };
  try {
    new Interpreter((line) => output.push(line)).interpret(parsed.value);
    return { output, errors: [] };
  } catch (error) {
    if (!(error instanceof RuntimeError)) throw error;
    return { output, errors: [formatRuntimeError(error)] };
  }
}
```

`run` is the whole pipeline in one place: scan, then parse, then interpret. It stops at the
first stage that fails. `(line) => output.push(line)` is the injected output: every line the
program prints lands in the `output` array instead of the terminal. Note that `line` has no
type annotation. It gets `string` from the `Output` type of the constructor parameter.

`scanned.error.map(formatDiagnostic)` passes the function itself to `map`. It works because
`formatDiagnostic` takes one `Diagnostic` and returns a `string`, which is exactly the
callback shape `map` wants here.

Run the tests:

```sh
npm test
```

You should see this three times:

```
SyntaxError: The requested module '../src/parser.ts' does not provide an export named 'parse'
```

Why three? `statements.test.ts` imports `helpers.ts`, but so do `ast.test.ts` and
`printer.test.ts` (for `tok`). When a module fails to load, **every file that imports it fails
too**, even tests that have nothing to do with statements. The summary says `pass 38`,
`fail 3`: each broken file counts as one failure.

Now ask the type checker:

```sh
npm run typecheck
```

```
test/helpers.ts(3,10): error TS2305: Module '"../src/parser.ts"' has no exported member 'parse'.
test/helpers.ts(25,21): error TS2554: Expected 0 arguments, but got 1.
test/helpers.ts(25,22): error TS7006: Parameter 'line' implicitly has an 'any' type.
test/helpers.ts(25,50): error TS2339: Property 'interpret' does not exist on type 'Interpreter'.
```

Node stopped at the first missing export. `tsc` tells you everything that's wrong. The
`implicitly has an 'any' type` error is a knock-on effect: with no constructor parameter,
there's no `Output` type for `line` to take its type from. It goes away once the constructor
exists.

## The code

### `src/ast.ts`: the statement union

Add this at the end of the file, after `export type Expr = …`:

```ts

export interface ExpressionStmt {
  readonly kind: "expression";
  readonly expression: Expr;
}

export interface PrintStmt {
  readonly kind: "print";
  readonly expression: Expr;
}

export type Stmt = ExpressionStmt | PrintStmt;
```

The two interfaces have the same fields. Only `kind` tells them apart, and that is enough for
narrowing.

### `src/parser.ts`: `parse()` and panic mode

Change the first import to also bring in `Stmt`:

```ts
import type { Expr, Stmt } from "./ast.ts";
```

Add the new public function right after `parseExpression` (the exported function at the top),
before `class ParseError`:

```ts
export function parse(tokens: readonly Token[]): Result<Stmt[], Diagnostic[]> {
  return new Parser(tokens).parseProgram();
}
```

Unlike `parseExpression`, it has no `try`/`catch`. `parseProgram` catches `ParseError`s
itself, one statement at a time.

Inside `class Parser`, add `parseProgram()` right after the constructor, **before** the
`parseExpression()` method:

```ts
  parseProgram(): Result<Stmt[], Diagnostic[]> {
    const statements: Stmt[] = [];
    const errors: Diagnostic[] = [];
    while (!this.isAtEnd()) {
      try {
        statements.push(this.declaration());
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        errors.push(error.diagnostic);
        this.synchronize();
      }
    }
    return errors.length > 0 ? err(errors) : ok(statements);
  }
```

`if (!(error instanceof ParseError)) throw error;` is the same guard you wrote in lesson 08:
only *our* errors are caught. A bug (say, the "ran past the end" error from `peek()`) must
not be turned into a diagnostic.

Now add the statement rules. Put them right after the `parseExpression()` method, and add an
`// ---- expressions ----` comment above the existing `expression()` method, so the class reads
in sections:

```ts
  // ---- statements ----

  private declaration(): Stmt {
    return this.statement();
  }

  private statement(): Stmt {
    if (this.match("print")) return this.printStatement();
    return this.expressionStatement();
  }

  private printStatement(): Stmt {
    const expression = this.expression();
    this.consume(";", "Expect ';' after value.");
    return { kind: "print", expression };
  }

  private expressionStatement(): Stmt {
    const expression = this.expression();
    this.consume(";", "Expect ';' after expression.");
    return { kind: "expression", expression };
  }

  // ---- expressions ----

  private expression(): Expr {
```

(The last line is the existing `expression()` method. Don't type it twice.)

`declaration()` just forwards to `statement()` for now. It exists because **declarations**
(`let`, `fn`) will be allowed in fewer places than other statements. `let` arrives next
lesson, and it goes into `declaration()`.

`{ kind: "print", expression }` uses shorthand property syntax (`expression: expression`).
The return type `Stmt` makes TypeScript check the literal against the union: misspell `kind`
and you get an error right here.

Last, add `synchronize()` as the first helper, right after the `// ---- helpers ----` comment
and before `consume()`:

```ts
  /** Skip tokens until we are probably at the start of the next statement. */
  private synchronize(): void {
    this.advance();
    while (!this.isAtEnd()) {
      if (this.previous().type === ";") return;
      switch (this.peek().type) {
        case "fn": case "let": case "if": case "while": case "print": case "return":
          return;
        default:
          this.advance();
      }
    }
  }
```

Trace it on the fourth test, `print (1;\nprint 2;\nprint +;`:

1. `print (1` then `consume(")")` sees `;` and throws `Expect ')' after expression.` at `;`.
   `peek()` is still the `;`.
2. `synchronize()` first calls `advance()`. That consumes the `;`, and it guarantees progress
   (without it, a statement that fails on its very first token would loop forever). Now
   `previous()` is `;`, so it returns.
3. `print 2;` parses normally.
4. `print +;` throws `Expect expression.` at `+`. `synchronize()` consumes the `+`. `previous()`
   is `+`, not `;`, and `peek()` is `;`, which isn't a keyword, so it advances once more. Now
   the next token is `eof`, so the loop ends, and so does `parseProgram`.

Two diagnostics, one run. Some keywords in the list (`fn`, `if`, `while`, `return`) don't
start statements yet. They will, and listing them now saves you coming back.

### `src/interpreter.ts`: `Output`, `interpret`, `execute`

Change the imports: `Stmt` from `ast.ts`, and `stringify` from `value.ts`:

```ts
import type { BinaryExpr, Expr, Stmt, UnaryExpr } from "./ast.ts";
import { assertNever } from "./assert-never.ts";
import { assertNumber, RuntimeError } from "./runtime-error.ts";
import { isEqual, isTruthy, stringify, type Value } from "./value.ts";
```

Then add the `Output` type above the class, and give the class a field, a constructor, and
two new methods before `evaluate`. Everything from the imports down to `evaluate` now reads:

```ts
export type Output = (line: string) => void;

export class Interpreter {
  private readonly output: Output;

  constructor(output: Output = console.log) {
    this.output = output;
  }

  interpret(statements: readonly Stmt[]): void {
    for (const statement of statements) {
      this.execute(statement);
    }
  }

  execute(stmt: Stmt): void {
    switch (stmt.kind) {
      case "expression":
        this.evaluate(stmt.expression);
        return;
      case "print":
        this.output(stringify(this.evaluate(stmt.expression)));
        return;
      default:
        assertNever(stmt);
    }
  }

  evaluate(expr: Expr): Value {
```

(`evaluate` and everything below it stays as it was.)

- `Output` is exported: the tests don't need it by name today, but a future REPL or file
  runner might want to write its own.
- `console.log`'s type is roughly `(...data: any[]) => void`. It accepts a `string`, so it's a
  valid `Output`. Node's `console` methods are already bound to `console`, so passing
  `console.log` around without calling it is safe.
- `interpret` takes `readonly Stmt[]`: it only reads the list, and saying so lets callers pass
  either kind of array.
- In the `"expression"` case the value of `this.evaluate(...)` is simply dropped. Evaluating
  is the whole point. It's how a runtime error in `1 + "a";` still gets raised.
- Every non-empty `case` ends with `return;`. You'll see why that matters in lesson 15
  (`noFallthroughCasesInSwitch`).

Run everything:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 46
ℹ pass 46
ℹ fail 0
```

That's the 41 from lesson 11 plus the 5 in `statements.test.ts`.

Commit:

```sh
git add -A
git commit -m "Add print and expression statements"
```

## Study Drills

1. **Break it on purpose.** In `test/helpers.ts`, change the injected output to
   `(line: number) => output.push(String(line))`. Run `npm run typecheck` and read the whole
   error, including the indented "Types of parameters…" lines. Which direction does the
   mismatch go? Then undo it.
2. **Break it on purpose.** In `execute`, delete the `case "print":` block (both lines and its
   `return;`). What does `tsc` say, and on which line? What does `npm test` say? Then undo it.
3. In `synchronize()`, comment out the first `this.advance();` and run `npm test`. Every test
   still passes. So is that `advance()` needed? Find a short program that makes `parse()` loop
   forever without it. (Hint: an error on the *first* token of a statement that comes right
   after a `;`.) Prove it with a temporary test (press Ctrl+C when it hangs). Then delete the
   test and undo the change.
4. Write down, in your own words, why the interpreter takes an `Output` in its constructor
   instead of calling `console.log` directly. Name one more thing in wyrm that might one day
   be worth injecting the same way.
5. **Small extension (then undo it).** Add a temporary test that runs `print 1; print 2 print 3;`.
   Predict the exact `errors` array before you run it, then check. Delete the test when you're
   done, so the count stays at 46.

## Checkpoint

Tell Claude: **"lesson 12 done"**. Expect questions like: *Why does a function returning a
number fit a `(line: string) => void` type? Why does `synchronize()` start with `advance()`?
Why did three test files fail when only one was new? Why does a syntax error on line 3 stop
line 2 from printing, when a runtime error on line 2 doesn't stop line 1?*
