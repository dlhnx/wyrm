# Lesson 06 — AST printer

## Goal

Write `printExpr`, a function that turns an AST into a short string that shows its structure:

```
-1 * (2 + 3)   →   (* (- 1) (group (+ 2 3)))
```

This style is called an **s-expression** (it comes from Lisp): every node is
`(name children…)`. It's unambiguous: you can see exactly what's nested inside what. From the
next lesson on, the parser tests will compare trees by printing them, because
`"(+ 1 (* 2 3))"` is much easier to read and write than a nested object literal.

Along the way you'll make exhaustiveness checking **explicit**, so that forgetting a case
is an error that points at the right place.

## Concepts

### `assertNever`: explicit exhaustiveness

In lesson 05 you saw implicit exhaustiveness. A `switch` with no `default` compiles because
every case returns. It works, but the error for a forgotten case points at the function's
return type and doesn't say what's missing. It also only works when every case returns a
value.

Here's the explicit version:

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

type Shape = Circle | Rect;

function name(s: Shape): string {
  switch (s.kind) {
    case "circle":
      return "circle";
    case "rect":
      return "rectangle";
    default:
      return assertNever(s);
  }
}
```

Follow the narrowing. After `case "circle"` is handled, `s` can only be a `Rect`. After
`case "rect"` is handled too, nothing is left, so in `default`, `s` has the type `never`, the
empty type from lesson 03. And `assertNever` only accepts `never`, so the call type-checks.

Now add `Triangle` to `Shape` and forget the case. In `default`, `s` is now a `Triangle`,
which is not `never`:

```
error TS2345: Argument of type 'Triangle' is not assignable to parameter of type 'never'.
```

The error is on the `default` line, and it **names the missing member**. Compare that with
lesson 05's "Function lacks ending return statement".

Two more things about `assertNever`:

- **Return type `never`** means "this function never returns". It always throws. Since
  `never` is assignable to everything, `return assertNever(s)` is fine in a function that
  returns `string`.
- **It also guards at runtime.** Types are erased. If a broken object ever does reach the
  `default` at runtime, you get a loud error that shows the value, not a silent `undefined`.

### Rest parameters

A **rest parameter** collects any number of arguments into an array:

```ts
function sum(label: string, ...nums: number[]): string {
  return `${label}: ${nums.reduce((a, b) => a + b, 0)}`;
}

sum("none");          // nums is []
sum("three", 1, 2, 3); // nums is [1, 2, 3]
```

It must be the last parameter, and its type is an array type. The caller passes separate
arguments, not an array. The **spread** syntax `...` does the opposite inside an array
literal: it unpacks an array into separate elements.

```ts
const inner = [2, 3];
const all = [1, ...inner, 4];   // [1, 2, 3, 4]
```

The printer uses both: a unary node has one child and a binary node has two, and one helper
handles both.

### `JSON.stringify` for quoting strings

To show that a literal is a string, the printer wraps it in quotes. Gluing quotes on by hand
(`"` + value + `"`) breaks as soon as the value contains a quote or a newline.
`JSON.stringify` of a string produces a properly quoted and escaped string:

```ts
JSON.stringify("hi");          // "hi"   (with the quotes)
JSON.stringify('say "hi"');    // "say \"hi\""
JSON.stringify("a\nb");        // "a\nb" (backslash n, not a real newline)
```

For numbers and booleans, `String(x)` gives the plain text: `String(1.5)` is `"1.5"`,
`String(true)` is `"true"`.

## Tests first

Create `test/printer.test.ts`. It reuses `tok` from `test/helpers.ts`.

### `test/printer.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Expr } from "../src/ast.ts";
import { printExpr } from "../src/printer.ts";
import { tok } from "./helpers.ts";

test("literals", () => {
  assert.equal(printExpr({ kind: "literal", value: 1.5 }), "1.5");
  assert.equal(printExpr({ kind: "literal", value: "hi" }), '"hi"');
  assert.equal(printExpr({ kind: "literal", value: true }), "true");
  assert.equal(printExpr({ kind: "literal", value: null }), "nil");
});

test("nested expressions print as s-expressions", () => {
  const expr: Expr = {
    kind: "binary",
    left: { kind: "unary", operator: tok("-"), right: { kind: "literal", value: 1 } },
    operator: tok("*"),
    right: {
      kind: "grouping",
      expression: {
        kind: "binary",
        left: { kind: "literal", value: 2 },
        operator: tok("+"),
        right: { kind: "literal", value: 3 },
      },
    },
  };
  assert.equal(printExpr(expr), "(* (- 1) (group (+ 2 3)))");
});
```

Notes:

- A string literal prints *with* quotes, so `"hi"` and the number-looking string `"1.5"`
  can never be confused with the numbers themselves.
- `null` prints as `nil`, wyrm's name for it.
- The tree is the same one as in lesson 05. The operator's lexeme becomes the node's name,
  and a grouping prints as `group`.

Run both:

```sh
npm test
npm run typecheck
```

`npm test` shows `ERR_MODULE_NOT_FOUND` for `src/printer.ts`, with `tests 16`, `pass 15`,
`fail 1` (the printer file counts as one failed test). `tsc` reports
`TS2307: Cannot find module '../src/printer.ts'`. If you want to see the other runtime
error again, create an empty `src/printer.ts` and run `npm test`: now it's the `SyntaxError`
about a missing export named `printExpr`.

## The code

### `src/assert-never.ts`

```ts
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
```

It gets its own file because more `switch`es over unions are coming, in the interpreter and
the resolver, and they'll all use it.

### `src/printer.ts`

```ts
import type { Expr, LiteralValue } from "./ast.ts";
import { assertNever } from "./assert-never.ts";

export function printExpr(expr: Expr): string {
  switch (expr.kind) {
    case "literal":
      return printLiteral(expr.value);
    case "grouping":
      return parenthesize("group", expr.expression);
    case "unary":
      return parenthesize(expr.operator.lexeme, expr.right);
    case "binary":
      return parenthesize(expr.operator.lexeme, expr.left, expr.right);
    default:
      return assertNever(expr);
  }
}

function printLiteral(value: LiteralValue): string {
  if (value === null) return "nil";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function parenthesize(name: string, ...exprs: Expr[]): string {
  return `(${[name, ...exprs.map(printExpr)].join(" ")})`;
}
```

**`printExpr`** has one case per `kind`, and `default: return assertNever(expr)`. In each
case `expr` is narrowed to one node type, so `expr.expression` is only allowed under
`"grouping"`, and `expr.left` only under `"binary"`. Two imports: the AST types with
`import type` (they vanish at runtime), and `assertNever` as a normal import, because it's
a real function.

**`printLiteral`** narrows `LiteralValue` step by step. After the `null` check, `value` is
`number | string | boolean`. After the `string` check, it's `number | boolean`, and
`String(value)` handles both.

**`parenthesize`** takes a name and any number of child expressions: one for grouping and
unary, two for binary. Read the body from the inside out:

1. `exprs.map(printExpr)` prints each child. It passes `printExpr` itself as the callback.
   `printExpr` calls `parenthesize`, which calls `printExpr` again: that's how the recursion
   walks down the tree.
2. `[name, ...children]` builds one array: the name first, then the printed children spread in.
3. `.join(" ")` separates them with spaces, and the template literal adds the parentheses.

`printLiteral` and `parenthesize` aren't exported. The module's API is just `printExpr`.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
✔ an AST for -1 * (2 + 3) (0.9ms)
✔ literals (0.5ms)
✔ nested expressions print as s-expressions (0.2ms)
✔ empty source is just eof (1.3ms)
…
✔ identifiers are not keywords (0.2ms)
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

That's 1 AST test, 2 printer tests, 12 scanner tests, and 2 token tests.

Commit:

```sh
git add -A
git commit -m "Add s-expression printer for the AST"
```

## Study Drills

1. Delete the `"binary"` case from `printExpr`. Read the error: which line does it point at,
   and which type does it name? Compare it with the error you got in lesson 05's drill 1.
   Undo it.
2. Delete the whole `default` branch (keep all four cases). Does it still compile? Explain
   why, using lesson 05. Then explain what you'd lose if a case were missing. Undo it.
3. Call `parenthesize` in the `"binary"` case with the two children wrapped in an array
   literal instead of as separate arguments. Read the error. Undo it.
4. In `printLiteral`, temporarily replace `JSON.stringify(value)` with a template literal that
   puts double quotes around `value`. Add a temporary assertion to the `"literals"` test for a
   string value containing a double quote, with the output `JSON.stringify` would give. Watch
   it fail, then restore `JSON.stringify` and watch it pass. Remove the extra assertion.
5. Explain in your own words why `return assertNever(expr);` is allowed in a function whose
   return type is `string`, and why `assertNever`'s parameter must be `never` and not
   `unknown`.
6. By hand, write the s-expression for `!(1 < 2) == false` as the parser will see it. Assume
   `==` binds looser than `<`, and unary `!` applies to the grouping.

## Checkpoint

Tell Claude: **"lesson 06 done"**. Expect questions like: *Why is `expr` of type `never` in
the `default` branch? How is `assertNever` better than lesson 05's implicit check? What's the
difference between a rest parameter and spread? Why use `JSON.stringify` to print strings?*
