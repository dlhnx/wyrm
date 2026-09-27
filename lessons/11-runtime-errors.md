# Lesson 11 — Runtime errors

## Goal

Make runtime errors say *where* they happened. By the end, `-"dragon"` produces
`[1:1] Runtime error: Operand must be a number.`, and `1 / (2 - 2)` is an error instead of
`Infinity`.

You'll write a `RuntimeError` class that carries the operator's token, and your first
**assertion function**: a function whose only job is to throw if a value has the wrong type,
and which narrows the value for the code after the call.

## Concepts

### Errors need a location

A plain `Error("Operands must be numbers.")` is useless in a 200-line program. Which operator?
The token knows: every token has a `line` and `col` from the scanner. So a runtime error carries
the token of the operator that failed, the same way `ParseError` carries a `Diagnostic`.

Why the operator and not the operand? In `"a" + 1` there are two operands and either could be
"wrong", but there's exactly one `+`. The operator is the thing that couldn't do its job.

`RuntimeError` is exported, unlike `ParseError`. It escapes the interpreter on purpose.
Diagnostics are collected before the program runs, but a runtime error stops a running program
at one point (see `CONTEXT.md`), and the code that runs the program (the CLI, the REPL, the
tests) catches it and reports it.

### Type predicates vs. assertion functions

You wrote a **type predicate** in lesson 02:

```ts
function isString(x: unknown): x is string {
  return typeof x === "string";
}
if (isString(v)) { v.toUpperCase(); } // narrowed inside the if
```

It returns a `boolean`, and the caller decides what to do with it.

An **assertion function** returns nothing. It either returns normally, which means the check
passed, or it throws:

```ts
function assertString(x: unknown): asserts x is string {
  if (typeof x !== "string") throw new Error("not a string");
}
assertString(v);
v.toUpperCase(); // narrowed for the rest of the scope, no if needed
```

`asserts x is string` tells TypeScript: "if this call returns, `x` is a `string`." Use a
predicate when both outcomes are normal and you want to branch. Use an assertion when the wrong
type is an error and you want to stop.

You've been using assertion functions since lesson 03: `assert.ok(result.ok)` in the tests is
declared as `asserts value`, which is why `result.value` works on the line after it.

Two rules to know:

- TypeScript trusts the signature. If the body forgets to throw, the narrowing is a lie.
  Keep assertion functions tiny, so it's obvious they're right.
- The function must be called through a name with an explicit type. A `function`
  declaration always qualifies. A `const f = (…) => …` with no type annotation doesn't, and you
  get `error TS2775: Assertions require every name in the call target to be declared with an
  explicit type annotation.`

### `never` as a return value

`assert.fail(message)` is declared as returning `never`. A `never` value can be used anywhere,
because a function that returns `never` doesn't return at all. So this compiles:

```ts
function first(xs: string[]): string {
  const x = xs[0];
  if (x !== undefined) return x;
  return assert.fail("empty"); // never is assignable to string
}
```

The test helper in this lesson uses exactly that inside a `try`. Watch out: `assert.fail`
throws an `AssertionError`, and the `catch` right below it will catch it too. That's why the
`catch` rethrows anything that isn't a `RuntimeError`.

### Division by zero is a language decision

In JavaScript, `1 / 0` is `Infinity` and `0 / 0` is `NaN`. Nothing fails; the strange value
just spreads through the rest of the program. wyrm makes a different choice: dividing by zero
is a runtime error, reported at the `/`. Neither is "correct". A language gets to decide, and
wyrm prefers loud failures. Note that `-0 === 0` is `true` in JavaScript, so `1 / -0` is
caught as well.

### `import type` for a class

`format.ts` needs `RuntimeError` only as the *type* of a parameter; it never calls `new` or
uses `instanceof`. Under `verbatimModuleSyntax`, that must be `import type`. The test file
uses `error instanceof RuntimeError`, which needs the class at runtime, so there it's a normal
import. Same class, two kinds of import, depending on how it's used.

## Tests first

Open `test/interpreter.test.ts`. Find the last existing import:

```ts
import type { Value } from "../src/value.ts";
```

Add these two lines right after it:

```ts
import { RuntimeError } from "../src/runtime-error.ts";
import { formatRuntimeError } from "../src/format.ts";
```

Then add this to the end of the file:

```ts
function runtimeError(source: string): string {
  try {
    const value = evaluate(source);
    return assert.fail(`expected a runtime error, got ${String(value)}`);
  } catch (error) {
    if (!(error instanceof RuntimeError)) throw error;
    return formatRuntimeError(error);
  }
}

test("negating a non-number", () => {
  assert.equal(runtimeError('-"dragon"'), "[1:1] Runtime error: Operand must be a number.");
});

test("mixing strings and numbers with +", () => {
  assert.equal(
    runtimeError('"a" + 1'),
    "[1:5] Runtime error: Operands must be two numbers or two strings.",
  );
});

test("comparing non-numbers", () => {
  assert.equal(runtimeError('1 < "2"'), "[1:3] Runtime error: Operands must be numbers.");
});

test("division by zero", () => {
  assert.equal(runtimeError("1 / (2 - 2)"), "[1:3] Runtime error: Division by zero.");
});
```

`runtimeError` is the mirror image of `evaluate`: it succeeds only if evaluation *fails* with a
`RuntimeError`, and returns the formatted message. `!(error instanceof RuntimeError)` needs the
parentheses. Without them, `!error` would be evaluated first. After the `throw`, `error` is
narrowed to `RuntimeError`, so `formatRuntimeError(error)` type-checks.

The columns are the operator's: `-` at 1, `+` at 5, `<` at 3, `/` at 3.

Run both:

```sh
npm test
npm run typecheck
```

`npm test`: `Cannot find module '…/src/runtime-error.ts'`. The whole interpreter test file
fails to load, so it counts as one failure, and the other 34 tests pass. `npm run typecheck`
reports two errors. `TS2307` for `runtime-error.ts`, and
`TS2305: Module '"../src/format.ts"' has no exported member 'formatRuntimeError'`. At runtime
you only see the first problem, because Node stops at the first module it can't find. `tsc`
checks everything.

## The code

### `src/runtime-error.ts`

```ts
import type { Token } from "./token.ts";
import type { Value } from "./value.ts";

export class RuntimeError extends Error {
  override readonly name = "RuntimeError";
  readonly token: Token;

  constructor(token: Token, message: string) {
    super(message);
    this.token = token;
  }
}

export function assertNumber(operator: Token, value: Value): asserts value is number {
  if (typeof value !== "number") {
    throw new RuntimeError(operator, "Operand must be a number.");
  }
}
```

`RuntimeError` has the same shape as `ParseError`: `override readonly name`, one extra
`readonly` field, and `super(message)` before touching `this`. It lives in its own file,
because the interpreter, the formatter and later the REPL and file runner all need it.

`assertNumber` takes the operator too, so the error it throws knows where it happened. Its
return type `asserts value is number` refers to the parameter by name.

### `src/format.ts`

Add the import below the existing one:

```ts
import type { Diagnostic } from "./diagnostic.ts";
import type { RuntimeError } from "./runtime-error.ts";
```

Add this function at the end of the file, after `formatDiagnostic`, with one blank line
between them:

```ts
export function formatRuntimeError(error: RuntimeError): string {
  return `[${error.token.line}:${error.token.col}] Runtime error: ${error.message}`;
}
```

Same `[line:col]` prefix as diagnostics, so all of wyrm's errors line up. `error.message` comes
from `Error`, set by `super(message)`.

### `src/interpreter.ts`

The changes are small but spread across the file, so here is the **whole file**. Compared with
lesson 10:

- one new import line, for `assertNumber` and `RuntimeError`;
- in `unary`, the `typeof` check becomes `assertNumber(expr.operator, right);`;
- every `throw new Error(…)` becomes `throw new RuntimeError(expr.operator, …)`;
- the `/` case gets its own two lines, with the division-by-zero check.

```ts
import type { BinaryExpr, Expr, UnaryExpr } from "./ast.ts";
import { assertNever } from "./assert-never.ts";
import { assertNumber, RuntimeError } from "./runtime-error.ts";
import { isEqual, isTruthy, type Value } from "./value.ts";

export class Interpreter {
  evaluate(expr: Expr): Value {
    switch (expr.kind) {
      case "literal":
        return expr.value;
      case "grouping":
        return this.evaluate(expr.expression);
      case "unary":
        return this.unary(expr);
      case "binary":
        return this.binary(expr);
      default:
        return assertNever(expr);
    }
  }

  private unary(expr: UnaryExpr): Value {
    const right = this.evaluate(expr.right);
    switch (expr.operator.type) {
      case "!":
        return !isTruthy(right);
      case "-":
        assertNumber(expr.operator, right);
        return -right;
      default:
        throw new RuntimeError(expr.operator, `Unknown unary operator '${expr.operator.lexeme}'.`);
    }
  }

  private binary(expr: BinaryExpr): Value {
    const left = this.evaluate(expr.left);
    const right = this.evaluate(expr.right);

    switch (expr.operator.type) {
      case "==":
        return isEqual(left, right);
      case "!=":
        return !isEqual(left, right);
      case "+":
        if (typeof left === "number" && typeof right === "number") return left + right;
        if (typeof left === "string" && typeof right === "string") return left + right;
        throw new RuntimeError(expr.operator, "Operands must be two numbers or two strings.");
    }

    if (typeof left !== "number" || typeof right !== "number") {
      throw new RuntimeError(expr.operator, "Operands must be numbers.");
    }
    switch (expr.operator.type) {
      case "-": return left - right;
      case "*": return left * right;
      case "/":
        if (right === 0) throw new RuntimeError(expr.operator, "Division by zero.");
        return left / right;
      case ">": return left > right;
      case ">=": return left >= right;
      case "<": return left < right;
      case "<=": return left <= right;
      default:
        throw new RuntimeError(expr.operator, `Unknown binary operator '${expr.operator.lexeme}'.`);
    }
  }
}
```

Look at the `-` case in `unary`. After `assertNumber(expr.operator, right);`, `right` is a
`number`, so `return -right;` compiles, with no `if`. That's the assertion function paying off.

In `binary`, the guard before the second switch is still a written-out `typeof` check, not
`assertNumber`: it checks *two* values and has its own message.

In the `/` case, `right` is already a `number` (the guard above narrowed it), so
`right === 0` is a plain number comparison.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing. Then:

```
ℹ tests 41
ℹ pass 41
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Report runtime errors with locations"
```

## Study Drills

1. Change `assertNumber`'s return type from `asserts value is number` to `value is number`.
   Run `npm run typecheck` and read *both* errors: one in `runtime-error.ts`, one in
   `interpreter.ts`. Explain each in one sentence. Then try `void` as the return type and
   compare. Undo it.
2. In the test helper, remove the `return` in front of `assert.fail`. Does it still
   type-check? Explain why, using what you know about `never`. Put it back.
3. Temporarily delete the `if (!(error instanceof RuntimeError)) throw error;` line and run
   `npm run typecheck`. Then put it back, and instead add a temporary test that calls
   `runtimeError("1 + 2")`. Read the failure: which error reached the `catch`, and where did
   it end up? Delete the test.
4. Temporarily rewrite `assertNumber` as a `const` arrow function without annotating the
   `const`. Read the TS2775 error. Undo it.
5. Explain in your own words why wyrm makes division by zero an error when JavaScript
   doesn't. Give one situation where `Infinity` quietly spreading would be worse than an error.
6. Optional extension: find another expression that should fail at runtime and isn't covered by
   the tests yet (think about `!`, `==` and `>=`). Predict the exact message and column, write
   the test, and check. Delete it afterwards so your tests match the lesson.

## Checkpoint

Tell Claude: **"lesson 11 done"**. Expect questions like: *What's the difference between
`x is number` and `asserts x is number`? Why does `RuntimeError` carry the operator token, and
not the operand? Why does `format.ts` use `import type` for `RuntimeError` but the test
doesn't? Why is `return assert.fail(…)` allowed in a function that returns `string`?*
