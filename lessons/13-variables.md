# Lesson 13 — Variables

## Goal

Give wyrm memory:

```
let name = "wyrm";
let count;          // nil
count = 1;
print name;
```

You'll add a `let` statement, two new expressions (reading a variable, assigning to one), and
an `Environment` class that stores the values. Along the way you'll do the most useful
refactoring move in TypeScript: **change a type first, then let the compiler tell you every
place that has to follow.**

## Concepts

### `Map<K, V>`

You already know plain objects as dictionaries. For a name → value table, `Map` is the
better tool:

```ts
const ages = new Map<string, number>();
ages.set("ada", 36);
ages.has("ada");   // true
ages.get("ada");   // 36
ages.get("bob");   // undefined
```

Why not `{ [name: string]: number }`?

- A plain object already has keys you didn't put there. `"constructor" in {}` is `true`.
  A wyrm program could name a variable `constructor` or `toString`. A `Map` starts truly empty.
- `has`, `get`, and `set` say exactly what they do. With an object you'd mix `in`, `obj[k]`,
  and `obj[k] = v`, and `noPropertyAccessFromIndexSignature` would push you to bracket access
  everywhere.
- `new Map<string, number>()` is a **generic** call. You pass the key and value types in angle
  brackets, the same way you've been using `Result<T, E>`.

### Why `Map.get` returns `V | undefined`

Look at the type of `get`:

```ts
get(key: K): V | undefined;
```

The key might not be there, and TypeScript can't know in advance. So you must handle
`undefined` before you can use the value as a `V`:

```ts
const age = ages.get("bob");
age + 1;                          // error: 'age' is possibly 'undefined'
if (age !== undefined) age + 1;   // fine: narrowed to number
```

Can you use `undefined` as the signal for "not found"? Only if `undefined` can never be a
*stored* value. Otherwise "stored undefined" and "missing" look the same. In wyrm that's
guaranteed: `Value` is `number | string | boolean | null`. wyrm's `nil` is `null`, and nothing
in the interpreter ever produces `undefined`. So `get` returning `undefined` can only mean
"no such key". If `Value` ever included `undefined`, this shortcut would break, and you'd have
to call `has()` first.

### The compiler as a refactoring guide

Today `Expr` gets two new members and `Stmt` gets one. Every `switch` over `kind` that ends in
`assertNever` is now incomplete, and `tsc` will point at each one. Here's the workflow:

1. Change the union first.
2. Run `npm run typecheck`.
3. Treat the error list as your to-do list. Fix one, rerun, and watch the list shrink.
4. When `tsc` is silent, every place that needed to change has changed.

There's a catch: **the tests keep passing** while `tsc` is red. Node strips the types and
nothing yet *creates* a variable node, so no code path hits the missing case at runtime. That's
ADR 0001 in action: running is not checking.

You'll also meet a second kind of exhaustiveness error. In lesson 05 you wrote `countNodes` in
`test/ast.test.ts` with no `default` at all. It worked because TypeScript could see the
`switch` covered every `kind`, so the end of the function was unreachable. Add a member and the
end becomes reachable. Falling off the end returns `undefined`, which isn't a `number`:

```ts
function area(s: Shape): number {   // error TS2366: Function lacks ending return statement
  switch (s.kind) {                 // and return type does not include 'undefined'.
    case "square": return s.side ** 2;
  }                                 // "circle" falls through to here
}
```

Same bug, different message. The `assertNever` style tells you *which member* is missing; the
no-default style only tells you *something* is.

### `Expr | null` for "maybe there is one"

`let x;` has no initializer. You could write `initializer?: Expr`, but with
`exactOptionalPropertyTypes` that means "the property may be absent", and every place that
builds a `LetStmt` would have to leave the key out rather than write `initializer: undefined`.
`initializer: Expr | null` is simpler: the field is always there, and `null` means "none".
wyrm uses `null` for "nothing" throughout (`nil` is `null` too).

### Parsing assignment: parse first, check after

`a = 1` is hard for a recursive-descent parser because you don't know it's an assignment
until you reach the `=`, and by then you've already parsed `a`. The trick:

1. Parse the left side as an ordinary expression (it comes back as a variable expression).
2. If the next token is `=`, check that what you parsed is a **variable**. If it is, turn it
   into an assignment. If it isn't (`1 + 2 = 3`), that's a syntax error: "Invalid
   assignment target."

The check is a narrowing: `if (expr.kind === "variable")` makes `expr.name` available.

Assignment is **right-associative**: `a = b = c` means `a = (b = c)`. You get that by having
`assignment()` call **itself** for the right-hand side, instead of looping like the binary
operators do. Recursion groups to the right; a `while` loop groups to the left.

And an assignment is an *expression*: its value is the assigned value. That's why `a = b = 3`
works. `b = 3` produces `3`, which is then assigned to `a`.

## Tests first

### `test/variables.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./helpers.ts";

test("declare and read a variable", () => {
  assert.deepEqual(run('let name = "wyrm"; print name;').output, ["wyrm"]);
});

test("a declaration without initializer is nil", () => {
  assert.deepEqual(run("let x; print x;").output, ["nil"]);
});

test("assignment changes the value and is itself an expression", () => {
  assert.deepEqual(run("let a = 1; let b = 2; a = b = 3; print a; print b;").output, [
    "3",
    "3",
  ]);
});

test("reading an undeclared variable", () => {
  assert.deepEqual(run("print dragon;").errors, [
    "[1:7] Runtime error: Undefined variable 'dragon'.",
  ]);
});

test("assigning an undeclared variable", () => {
  assert.deepEqual(run("dragon = 1;").errors, [
    "[1:1] Runtime error: Undefined variable 'dragon'.",
  ]);
});

test("redeclaring in the same scope", () => {
  assert.deepEqual(run("let a = 1; let a = 2;").errors, [
    "[1:16] Runtime error: Variable 'a' is already declared in this scope.",
  ]);
});

test("invalid assignment target", () => {
  assert.deepEqual(run("1 + 2 = 3;").errors, [
    "[1:7] Error at '=': Invalid assignment target.",
  ]);
});
```

Count columns for the redeclaration test: `let a = 1; ` is 11 characters, so the second `let`
starts at column 12 and its name `a` at column 16. The error points at the **name**, not at
`let`.

Run `npm test`. This time nothing is missing at import time, so the file loads and 7 tests
fail on their assertions. The first three print nothing (`actual: []`) because the programs
don't parse. The rest show the parser choking on names it doesn't understand yet:

```
    actual: [ "[1:7] Error at 'dragon': Expect expression." ],
    expected: [ "[1:7] Runtime error: Undefined variable 'dragon'." ],
```

`npm run typecheck` is clean. These tests only use `run()`, which already exists.

## The code

### Step 1 — Change the types first

In `src/ast.ts`, add the two new expression interfaces after `BinaryExpr`, and rewrite the
`Expr` union to include them. With six members it's easier to read one per line. Find:

```ts
export type Expr = LiteralExpr | GroupingExpr | UnaryExpr | BinaryExpr;
```

Replace it with:

```ts
export interface VariableExpr {
  readonly kind: "variable";
  readonly name: Token;
}

export interface AssignExpr {
  readonly kind: "assign";
  readonly name: Token;
  readonly value: Expr;
}

export type Expr =
  | LiteralExpr
  | GroupingExpr
  | UnaryExpr
  | BinaryExpr
  | VariableExpr
  | AssignExpr;
```

The leading `|` before the first member is allowed and purely cosmetic. It keeps every line
the same shape.

`name` is a whole `Token`, not a `string`. The token carries the line and column, and runtime
errors need them.

At the end of the file, find:

```ts
export type Stmt = ExpressionStmt | PrintStmt;
```

Replace it with:

```ts
export interface LetStmt {
  readonly kind: "let";
  readonly name: Token;
  readonly initializer: Expr | null;
}

export type Stmt = ExpressionStmt | PrintStmt | LetStmt;
```

### Step 2 — Read the to-do list

```sh
npm run typecheck
```

```
src/interpreter.ts(30,21): error TS2345: Argument of type 'LetStmt' is not assignable to parameter of type 'never'.
src/interpreter.ts(45,28): error TS2345: Argument of type 'AssignExpr | VariableExpr' is not assignable to parameter of type 'never'.
  Type 'AssignExpr' is not assignable to type 'never'.
src/printer.ts(15,26): error TS2345: Argument of type 'AssignExpr | VariableExpr' is not assignable to parameter of type 'never'.
  Type 'AssignExpr' is not assignable to type 'never'.
test/ast.test.ts(6,34): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

Read it slowly. The three `assertNever` calls tell you exactly which members they're missing:
`LetStmt` in `execute`, `AssignExpr | VariableExpr` in `evaluate` and `printExpr`. The fourth
error is `countNodes` in `test/ast.test.ts`, the function you wrote in lesson 05. It's test
code, but it's type-checked too, so it's on the list.

Now run `npm test`. The same 46 tests pass, and only the 7 new ones fail. The types are broken,
and the tests can't see it.

Work through the list. The parser isn't on it (it never switches over `kind`), so you'll do it
last.

### Step 3 — `src/environment.ts` (new file)

The interpreter needs somewhere to keep values. Create the file:

```ts
import { RuntimeError } from "./runtime-error.ts";
import type { Token } from "./token.ts";
import type { Value } from "./value.ts";

export class Environment {
  private readonly values = new Map<string, Value>();

  define(name: Token, value: Value): void {
    if (this.values.has(name.lexeme)) {
      throw new RuntimeError(name, `Variable '${name.lexeme}' is already declared in this scope.`);
    }
    this.values.set(name.lexeme, value);
  }

  get(name: Token): Value {
    const value = this.values.get(name.lexeme);
    if (value === undefined) {
      throw new RuntimeError(name, `Undefined variable '${name.lexeme}'.`);
    }
    return value;
  }

  assign(name: Token, value: Value): void {
    if (!this.values.has(name.lexeme)) {
      throw new RuntimeError(name, `Undefined variable '${name.lexeme}'.`);
    }
    this.values.set(name.lexeme, value);
  }
}
```

- `private readonly values`: `readonly` stops anyone from *replacing* the map. It doesn't
  stop `set` from *changing its contents*. `readonly` is about the field, not the object in it.
- The map is keyed by `name.lexeme`, the variable's text. The token itself is only used for
  error positions.
- `get` checks `value === undefined` and throws. After that `if`, TypeScript has narrowed
  `value` from `Value | undefined` to `Value`, so `return value;` type-checks with no `!`.
  This is the "`undefined` means missing" rule from Concepts. A variable holding `nil` is
  stored as `null`, which is not `undefined`, so `let x; print x;` works.
- `assign` uses `has`, because it never needs the old value.
- `define` refuses a **redeclaration** (see `CONTEXT.md`): `let a = 1; let a = 2;` is an
  error in wyrm, not a silent overwrite.

### Step 4 — `src/interpreter.ts`

Add the import (keep the imports sorted by path, as the file already is):

```ts
import { assertNever } from "./assert-never.ts";
import { Environment } from "./environment.ts";
import { assertNumber, RuntimeError } from "./runtime-error.ts";
```

Add a field right after `output`:

```ts
  private readonly output: Output;
  private readonly environment = new Environment();
```

No type annotation is needed: `new Environment()` already says what it is.

In `execute`, add a case after `"print"`, before `default`:

```ts
      case "let": {
        const value = stmt.initializer === null ? null : this.evaluate(stmt.initializer);
        this.environment.define(stmt.name, value);
        return;
      }
```

The braces around the case body are needed because it declares a `const`. Without them,
`value` would belong to the whole `switch`, and a later case declaring its own `value` would
clash with it. Braces give the case its own block.

`stmt.initializer === null ? null : …` narrows too: on the right of `:`, TypeScript knows
`stmt.initializer` is an `Expr`.

In `evaluate`, add two cases after `"binary"`, before `default`:

```ts
      case "variable":
        return this.environment.get(expr.name);
      case "assign": {
        const value = this.evaluate(expr.value);
        this.environment.assign(expr.name, value);
        return value;
      }
```

`return value;` is what makes assignment an expression: `a = b = 3` gets `3` back from the
inner assignment.

Run `npm run typecheck`. Two errors left.

### Step 5 — `src/printer.ts`

Add two cases after `"binary"`, before `default`:

```ts
    case "variable":
      return expr.name.lexeme;
    case "assign":
      return parenthesize(`= ${expr.name.lexeme}`, expr.value);
```

A variable prints as its name. `a = 1` prints as `(= a 1)`. The name goes into the "operator"
slot because `parenthesize` only takes `Expr`s after it, and the name is a token, not an
expression.

### Step 6 — `test/ast.test.ts`

Add two cases at the end of the `switch` in `countNodes`, after `"binary"`:

```ts
    case "variable":
      return 1;
    case "assign":
      return 1 + countNodes(expr.value);
```

Now `tsc` is silent: the switch covers every member again, so the end of the function is
unreachable again.

### Step 7 — `src/parser.ts`

The types are complete. Now teach the parser to produce the new nodes. In `declaration()`,
add a line before `return this.statement();`, and add `letDeclaration()` right after it:

```ts
  private declaration(): Stmt {
    if (this.match("let")) return this.letDeclaration();
    return this.statement();
  }

  private letDeclaration(): Stmt {
    const name = this.consume("identifier", "Expect variable name.");
    const initializer = this.match("=") ? this.expression() : null;
    this.consume(";", "Expect ';' after variable declaration.");
    return { kind: "let", name, initializer };
  }
```

`consume` returns the token it consumed. That's how you get `name` without a separate
`previous()` call.

Next, `expression()` no longer starts at equality. Find:

```ts
  private expression(): Expr {
    return this.equality();
  }
```

Replace it with:

```ts
  private expression(): Expr {
    return this.assignment();
  }

  private assignment(): Expr {
    const expr = this.equality();
    if (this.match("=")) {
      const equals = this.previous();
      const value = this.assignment(); // right-associative: a = b = c
      if (expr.kind === "variable") {
        return { kind: "assign", name: expr.name, value };
      }
      throw this.error(equals, "Invalid assignment target.");
    }
    return expr;
  }
```

Assignment has the **lowest** precedence of all, so it's the first rule `expression()` calls.

- `const equals = this.previous();` keeps the `=` token so the error can point at it.
  That's where `[1:7] Error at '='` comes from.
- The right-hand side is parsed *before* the target is checked. Either order reports the same
  error for `1 + 2 = 3;`, but parsing first keeps the rule short.
- `throw this.error(...)` goes through panic mode from lesson 12: `parseProgram` catches
  it, records it, and synchronizes.

Last, `primary()` has to recognise a name. Add this right after the `number`/`string` case,
before the `(` case:

```ts
    if (this.match("identifier")) {
      return { kind: "variable", name: this.previous() };
    }
```

Run everything:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 53
ℹ pass 53
ℹ fail 0
```

46 from before plus the 7 in `variables.test.ts`.

Commit:

```sh
git add -A
git commit -m "Add variables, let and assignment"
```

## Study Drills

1. **Break it on purpose.** In `Environment.get`, replace the three lines of the `if` with
   nothing, so the method is just `const value = …; return value;`. Run `npm run typecheck`
   and read the error. Which exact type does TypeScript say `value` has? Then undo it.
2. **Break it on purpose.** In `ast.test.ts`, delete the `case "assign":` lines from
   `countNodes`. Compare the error with the one you get from deleting `case "assign":` in
   `printer.ts` instead. Which message would you rather get in a big codebase, and why? Then
   undo both.
3. Explain in your own words why `undefined` is a safe "not found" signal in `Environment`,
   and describe a change to `Value` that would make it unsafe.
4. Make `assignment()` loop instead of recurse (like `term()` does), just for a moment. Which
   test fails, and with what error? Trace `a = b = 3` by hand to explain it. Then undo it.
5. **Small extension (then undo it).** Add a temporary test for `let a = 1; a + 1 = 2;` and
   `let a; (a) = 1;`. Predict each `errors` array first. Is `(a) = 1` valid in wyrm? Should it
   be? Delete the test when you're done.

## Checkpoint

Tell Claude: **"lesson 13 done"**. Expect questions like: *Why does `Map.get` return
`Value | undefined`, and how did `get` turn it into `Value` without `!`? Why did `tsc` fail
while `npm test` still passed 46 tests? What makes `a = b = c` right-associative? Why does
the `"let"` case need braces?*
