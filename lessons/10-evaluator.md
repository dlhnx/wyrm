# Lesson 10 — Evaluating expressions

## Goal

Make wyrm compute things. By the end, `1 + 2 * 3` evaluates to `7`, `"wy" + "rm"` to
`"wyrm"`, and `1 == "1"` to `false`. You'll define what a wyrm **value** is, write the rules for
truthiness and equality, and build the first piece of the **interpreter**: a method that walks
an expression tree and returns its value.

The main idea is that TypeScript won't let you do arithmetic on something that *might* not be
a number, and that's exactly the check a dynamically typed language like wyrm needs at runtime.

## Concepts

### The `Value` union

Everything a wyrm expression can produce, as a TypeScript type:

```ts
export type Value = number | string | boolean | null;
```

wyrm's `nil` is TypeScript's `null`. Right now `Value` looks the same as `LiteralValue` from
lesson 05, but they mean different things. `LiteralValue` is what can be *written in source*;
`Value` is what can *exist at runtime*. In lesson 17 functions become values, and `Value`
grows a callable member that `LiteralValue` never gets. With two names, that change stays
inside `value.ts`.

### wyrm's rules, written as functions

`CONTEXT.md` defines three things. Each becomes a tiny function in `src/value.ts`:

- **Truthy / falsy**: only `false` and `nil` are falsy. `0` and `""` are truthy. That's
  stricter than JavaScript, where `0`, `""` and `NaN` are falsy too. So `isTruthy` can't just
  be `Boolean(value)`. It checks the two falsy values explicitly.
- **Equality**: same type and same value, no conversions. `1 == "1"` is false. JavaScript's
  `===` already behaves exactly like that for numbers, strings, booleans and `null`, so
  `isEqual` is `a === b`. (When callables arrive, `===` on objects compares identity, which is
  also what the glossary asks for.)
- **Printing a value**: `stringify` turns a value into the text `print` will show (lesson
  12). `nil` prints as `nil`, not `null`. Strings print *without* quotes. That's the difference
  from `printExpr` in lesson 06, which shows `"hi"` with quotes because it prints source code,
  not values.

### Why `left - right` doesn't compile

Here's the core of this lesson:

```ts
function subtract(a: number | string, b: number | string) {
  return a - b; // error TS2362: The left-hand side of an arithmetic operation must be
                // of type 'any', 'number', 'bigint' or an enum type.
}
```

TypeScript refuses because `a` might be a string. In JavaScript, `"5" - 2` quietly gives `3`,
and `"a" - 2` gives `NaN`. Neither is an error, so JavaScript never tells you something went
wrong. The type checker is making you decide what should happen.

wyrm has the same problem at *runtime*: `-"dragon"` is legal syntax, but it's meaningless. So
the interpreter must check the types of the operands before it does the arithmetic. The check
you write to satisfy `tsc` is exactly the check wyrm needs. Leave it out, and `tsc` fails.

### `typeof` narrowing, two variables at once

You know `typeof x === "number"` narrows `x`. You can narrow two variables in one condition:

```ts
function add(a: number | string, b: number | string): number | string {
  if (typeof a === "number" && typeof b === "number") return a + b; // both number
  if (typeof a === "string" && typeof b === "string") return a + b; // both string
  throw new Error("mixed");
}
```

With `&&`, both checks are true inside the `if`, so both are narrowed. The negated form works
too, and it's often neater: rule out the bad cases once, and everything after is narrowed:

```ts
if (typeof a !== "number" || typeof b !== "number") {
  throw new Error("need numbers");
}
a * b; // both number here
```

Read the condition as "if either one is not a number, bail out". If you get past the `if`,
neither was not a number: both are numbers.

### A switch that doesn't cover everything

`evaluate` switches on `expr.kind` with `assertNever` in `default`, like the printer: a new
kind of expression must be handled, or `tsc` complains.

The operator switches are different. `expr.operator.type` is a `TokenType`, which has
about thirty members. The AST doesn't restrict which token a unary or binary node holds; the
parser just never builds `(; 1 2)`. So those switches can't be exhaustive, and their `default`
throws a plain `Error`. If one fires, it's a parser bug.

## Tests first

### `test/value.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isEqual, isTruthy, stringify } from "../src/value.ts";

test("only false and nil are falsy", () => {
  assert.equal(isTruthy(false), false);
  assert.equal(isTruthy(null), false);
  assert.equal(isTruthy(0), true);
  assert.equal(isTruthy(""), true);
  assert.equal(isTruthy("no"), true);
});

test("equality never converts types", () => {
  assert.equal(isEqual(1, 1), true);
  assert.equal(isEqual("1", 1), false);
  assert.equal(isEqual(null, false), false);
  assert.equal(isEqual(null, null), true);
});

test("stringify", () => {
  assert.equal(stringify(null), "nil");
  assert.equal(stringify(3), "3");
  assert.equal(stringify(2.5), "2.5");
  assert.equal(stringify(true), "true");
  assert.equal(stringify("wyrm"), "wyrm");
});
```

These test the three rules on their own, without scanning or parsing anything. Each assertion
is one sentence from `CONTEXT.md`.

### `test/interpreter.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Interpreter } from "../src/interpreter.ts";
import { parseExpression } from "../src/parser.ts";
import { scan } from "../src/scanner.ts";
import type { Value } from "../src/value.ts";

function evaluate(source: string): Value {
  const scanned = scan(source);
  assert.ok(scanned.ok);
  const parsed = parseExpression(scanned.value);
  assert.ok(parsed.ok);
  return new Interpreter().evaluate(parsed.value);
}

test("arithmetic", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("10 / 4"), 2.5);
  assert.equal(evaluate("-(3 - 5)"), 2);
});

test("string concatenation", () => {
  assert.equal(evaluate('"wy" + "rm"'), "wyrm");
});

test("comparison and equality", () => {
  assert.equal(evaluate("1 < 2"), true);
  assert.equal(evaluate("2 <= 1"), false);
  assert.equal(evaluate('1 == "1"'), false);
  assert.equal(evaluate("nil == nil"), true);
  assert.equal(evaluate("!nil"), true);
  assert.equal(evaluate("!0"), false);
});
```

The `evaluate` helper runs the whole pipeline: scan, parse, evaluate. The tests are written in
wyrm, not as hand-built trees. `10 / 4` is `2.5` because wyrm numbers are JavaScript numbers,
so there's no integer division. `!0` is `false` because `0` is truthy.

Run both:

```sh
npm test
npm run typecheck
```

`npm test`: both new files fail to load, with `Cannot find module '…/src/interpreter.ts'`
and `Cannot find module '…/src/value.ts'`. The other 31 tests pass. `npm run typecheck` reports
three TS2307 errors, one for each import of a missing file.

## The code

### `src/value.ts`

```ts
export type Value = number | string | boolean | null;

export function isTruthy(value: Value): boolean {
  return value !== null && value !== false;
}

export function isEqual(a: Value, b: Value): boolean {
  return a === b;
}

export function stringify(value: Value): string {
  if (value === null) return "nil";
  return String(value);
}
```

Each function is one line of real work. They're still worth having. Every place in the
interpreter that needs "is this truthy?" calls `isTruthy`, so the rule lives in one place.

Run `npm test`. The value tests pass.

### `src/interpreter.ts`

```ts
import type { BinaryExpr, Expr, UnaryExpr } from "./ast.ts";
import { assertNever } from "./assert-never.ts";
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
        if (typeof right !== "number") throw new Error("Operand must be a number.");
        return -right;
      default:
        throw new Error(`Unknown unary operator '${expr.operator.lexeme}'.`);
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
        throw new Error("Operands must be two numbers or two strings.");
    }

    if (typeof left !== "number" || typeof right !== "number") {
      throw new Error("Operands must be numbers.");
    }
    switch (expr.operator.type) {
      case "-": return left - right;
      case "*": return left * right;
      case "/": return left / right;
      case ">": return left > right;
      case ">=": return left >= right;
      case "<": return left < right;
      case "<=": return left <= right;
      default:
        throw new Error(`Unknown binary operator '${expr.operator.lexeme}'.`);
    }
  }
}
```

### Walking through it

**`evaluate(expr)`.** One case per expression kind:

- `literal`: the value is right there in the node. `LiteralValue` is assignable to `Value`, so
  no conversion is needed.
- `grouping`: parentheses only affect how the tree was *built*. At run time, a group is just
  its inside.
- `unary` and `binary` get their own methods, which receive the narrowed type (`UnaryExpr`,
  `BinaryExpr`). That's why the import lists those two types.

**`unary(expr)`.** Evaluate the operand first, then apply the operator. `!` works on any value,
using wyrm's truthiness. `-` needs a number: the `typeof` check both reports the problem and
narrows `right` so that `-right` compiles. The errors are plain `Error`s for now; lesson 11
gives them a location.

**`binary(expr)`.** Both operands are evaluated first, left then right. Then there are two
switches, on purpose.

The **first switch** handles the operators that accept *any* values: `==` and `!=` (equality is
defined for every pair of values) and `+` (numbers *or* strings). Every case returns or throws.
There's no `default`, so any other operator falls out of the switch and continues.

Then **one guard** narrows both operands to `number`. After it, the **second switch** can do
`-`, `*`, `/`, `>`, `>=`, `<`, `<=` with no further checks. Without the split, you'd repeat the
same `typeof` check in seven cases.

Look at `+`. The two `if`s try "both numbers", then "both strings". Mixed operands, like
`"a" + 1`, fall through to the `throw`. JavaScript would produce `"a1"`; wyrm refuses.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing. Then:

```
ℹ tests 37
ℹ pass 37
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Evaluate expressions"
```

## Study Drills

1. Delete the `if (typeof left !== "number" || typeof right !== "number")` guard (all three
   lines) and run `npm run typecheck`. Count the errors and read the first two in full. Then
   put the guard back, but make it check only `left`. Which errors remain? Undo it.
2. In the second switch of `binary`, add a `case "+"` that returns `0`. Run
   `npm run typecheck`. The error says `"+"` isn't comparable to a long list of token types.
   Look for `"+"`, `"=="` and `"!="` in that list. What did TypeScript learn from the first
   switch? Undo it.
3. Replace the body of `isTruthy` with `return Boolean(value);`. Which tests fail, and which
   rule in `CONTEXT.md` does that break? Undo it.
4. Write down, without running anything, what these evaluate to: `"a" == "a"`,
   `1 + 2 == 3`, `!!""`, `-(-(2))`, `3 > 2 > 1`. The last one surprises people; explain what
   happens step by step. Then check your answers with temporary tests and delete them.
5. Explain in your own words why the `unary` and `binary` switches end in `throw`, but
   `evaluate`'s switch ends in `assertNever`.
6. Optional extension: JavaScript has `0.1 + 0.2 == 0.3` as `false`. Does wyrm? Check with a
   temporary test, explain why, then delete the test.

## Checkpoint

Tell Claude: **"lesson 10 done"**. Expect questions like: *Why does `tsc` reject
`left - right` when both are `Value`? What does `typeof a !== "number" || typeof b !==
"number"` tell TypeScript after the `if`? Why isn't `isTruthy` just `Boolean(value)`? Why
does `binary` use two switches?*
