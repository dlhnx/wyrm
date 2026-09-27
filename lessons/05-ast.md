# Lesson 05 — The AST

## Goal

Define the **AST**, the tree the parser will build from tokens. This lesson covers
**expressions** only: literals, grouping (parentheses), unary operators (`-x`, `!x`), and
binary operators (`a + b`). Statements come later.

There's no parser yet, so the test builds a tree by hand and walks it. This lesson is mostly
types. The shape you define here is what the parser produces (lesson 07), the printer prints
(lesson 06), and the interpreter evaluates (lesson 10).

## Concepts

### Discriminated unions with a `kind` tag

You met a discriminated union in lesson 03: `Result` uses `ok: true | false` to say which
member you have. When there are more than two members, the usual convention is a string
property called `kind`:

```ts
interface Circle {
  readonly kind: "circle";
  readonly radius: number;
}

interface Rect {
  readonly kind: "rect";
  readonly width: number;
  readonly height: number;
}

type Shape = Circle | Rect;

function area(s: Shape): number {
  if (s.kind === "circle") {
    return Math.PI * s.radius ** 2;   // s is Circle
  }
  return s.width * s.height;          // s is Rect
}
```

Each member has its own literal type for `kind`, so checking `kind` narrows to exactly one
member, with exactly its properties. Outside the check, `s.radius` is an error: a `Rect`
doesn't have one.

This is how TypeScript models what other languages do with class hierarchies and
`instanceof`. The nodes are plain objects. Operations on them are functions that `switch`
on `kind`.

### Recursive types

An expression can contain expressions: in `1 + 2`, both sides are expressions, and so is
the whole thing. So the types refer to themselves:

```ts
interface Pair {
  readonly kind: "pair";
  readonly first: Tree;
  readonly second: Tree;
}

interface Leaf {
  readonly kind: "leaf";
  readonly value: number;
}

type Tree = Pair | Leaf;
```

`Pair` mentions `Tree`, and `Tree` includes `Pair`. That's allowed, because the reference
goes through an interface's property. And the recursion ends, because a `Leaf` contains no
further trees. Every real tree bottoms out in leaves.

### `readonly` everywhere

Once built, an AST never changes. The parser builds it, and everything after that only
*reads* it. Marking every property `readonly` makes the compiler enforce that. It also
means one node can safely be shared or kept around (the resolver in lesson 23 relies on
that) without anyone changing it behind your back.

### Exhaustiveness through "every path must return"

Look at this function. It has no `default`, and no `return` after the `switch`:

```ts
function sides(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return 0;
    case "rect":
      return 4;
  }
}
```

It still compiles. The return type says `number`, so every path through the function must
return a number (and `noImplicitReturns` from lesson 01 makes that a rule even for return
types that would allow `undefined`). TypeScript knows `Shape` has exactly two kinds, and both
cases return, so the end of the function can't be reached.

Now add a `Triangle` to `Shape` and forget to update `sides`. The end of the function *is*
reachable now, for triangles, and you get:

```
error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

The compiler found the function you forgot. This is **implicit** exhaustiveness checking:
it works, but the error points at the function's return type, not at the missing case, and it
only works when every case returns. Lesson 06 shows the explicit version.

## Tests first

Two files this time. `test/helpers.ts` holds a small helper that several test files will
share. It doesn't end in `.test.ts`, so the test glob in `package.json` doesn't run it as a
test file. It's only loaded when a test imports it.

Create `test/ast.test.ts` first.

### `test/ast.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Expr } from "../src/ast.ts";
import { tok } from "./helpers.ts";

function countNodes(expr: Expr): number {
  switch (expr.kind) {
    case "literal":
      return 1;
    case "grouping":
      return 1 + countNodes(expr.expression);
    case "unary":
      return 1 + countNodes(expr.right);
    case "binary":
      return 1 + countNodes(expr.left) + countNodes(expr.right);
  }
}

test("an AST for -1 * (2 + 3)", () => {
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
  assert.equal(countNodes(expr), 7);
});
```

`countNodes` is the function from the Concepts: a `switch` on `kind` with no `default`,
where every case returns. It's recursive, like the type it walks. The test builds the tree
for `-1 * (2 + 3)` by hand. The `*` is at the top because it's applied last. Count the
`kind`s: seven nodes.

Run `npm test`. You get `ERR_MODULE_NOT_FOUND` for `test/helpers.ts`. Now create it.

### `test/helpers.ts`

```ts
import type { Token, TokenType } from "../src/token.ts";

export function tok(type: TokenType, lexeme: string = type): Token {
  return { type, lexeme, literal: null, line: 1, col: 1 };
}
```

`tok("-")` builds an operator token without the noise of a full object literal. The default
`lexeme: string = type` uses an *earlier parameter* as the default. For `"-"`, `"*"`, and
`"+"`, the lexeme is the same as the type. `type` is a `TokenType`, and every `TokenType` is
a string, so it fits.

Now run both:

```sh
npm test
npm run typecheck
```

This is the surprise of the lesson: **`npm test` passes**, `tests 15`, `pass 15`, even though
`src/ast.ts` doesn't exist. `import type { Expr }` is deleted by the type stripper, and nothing
at runtime needs `ast.ts`. The test only builds plain objects and counts them.

`npm run typecheck` tells the truth:

```
test/ast.test.ts(3,27): error TS2307: Cannot find module '../src/ast.ts' or its corresponding type declarations.
test/ast.test.ts(6,34): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

The second error is a knock-on error. Without `ast.ts`, the compiler doesn't know which kinds
exist, so it can't tell that the `switch` covers them all. This is the README's warning in
action: running is not checking.

## The code

### `src/ast.ts`

```ts
import type { Token } from "./token.ts";

export type LiteralValue = number | string | boolean | null;

export interface LiteralExpr {
  readonly kind: "literal";
  readonly value: LiteralValue;
}

export interface GroupingExpr {
  readonly kind: "grouping";
  readonly expression: Expr;
}

export interface UnaryExpr {
  readonly kind: "unary";
  readonly operator: Token;
  readonly right: Expr;
}

export interface BinaryExpr {
  readonly kind: "binary";
  readonly left: Expr;
  readonly operator: Token;
  readonly right: Expr;
}

export type Expr = LiteralExpr | GroupingExpr | UnaryExpr | BinaryExpr;
```

Notes:

- `LiteralValue` is not the same as `Literal` in `token.ts`. It includes `boolean`. The
  scanner never produces a boolean literal (`true` is a keyword token), but the *parser* will
  turn the `true` keyword into a literal expression whose value is `true`. And `null` stands
  for wyrm's `nil`.
- `GroupingExpr` represents parentheses. It looks redundant, since `(2 + 3)` means the same
  as `2 + 3` once it's a tree, but keeping it lets the printer show exactly what was written.
- `operator` is the whole `Token`, not just its type. Later, when `-"x"` fails at runtime,
  the interpreter can report the operator's line and column.
- Only `Expr` is used outside this file for now, but every member is exported. The printer
  and interpreter will need to name them.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
✔ an AST for -1 * (2 + 3) (0.9ms)
✔ empty source is just eof (1.3ms)
…
✔ identifiers are not keywords (0.2ms)
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

That's 1 AST test, 12 scanner tests, and 2 token tests.

Commit:

```sh
git add -A
git commit -m "Add expression AST types"
```

## Study Drills

1. Delete the `"binary"` case from `countNodes`. Read the error, and notice *where* it points.
   Explain why removing a case makes the end of the function reachable. Undo it.
2. Inside the `"unary"` case of `countNodes`, try to read `expr.expression`. Read the error:
   which type does TypeScript say `expr` has there? Undo it.
3. Optional extension: add a fifth member to `Expr` for a variable reference (give it a
   `kind` and a `name` that's a `Token`). Run `npm run typecheck` and see what the compiler
   flags, and what it doesn't. Then remove it again so your code matches the lesson.
4. In the test, after building `expr`, try to change its `kind`. Read the error. Then try to
   change `expr.left`. Undo it.
5. Draw the tree for `-1 * (2 + 3)` on paper, one box per node, and check it has seven boxes.
   Then draw `(1 + 2) * 3 - 4` and count its nodes.
6. Explain in your own words why the test passed at runtime before `src/ast.ts` existed, and
   why `tsc` still reported the error on `countNodes`.

## Checkpoint

Tell Claude: **"lesson 05 done"**. Expect questions like: *What makes a union
"discriminated"? How can `BinaryExpr` contain an `Expr` when `Expr` contains `BinaryExpr`?
Why does `countNodes` compile without a `default` or a final `return`? Why isn't
`test/helpers.ts` run as a test?*
