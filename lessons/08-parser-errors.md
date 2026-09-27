# Lesson 08 — Parser II: comparisons and errors

## Goal

Finish the expression grammar and make bad input produce a proper **diagnostic** instead of a
crash. By the end, `1 < 2 == true` parses, `(1 + 2) * 3` groups, and `1 +` returns
`{ line: 1, col: 4, message: "Expect expression.", at: "end" }` as a value you can test.

Along the way you'll write your first custom `Error` subclass, and see why `catch (error)`
gives you an `unknown`.

## Concepts

### Two more precedence levels, and grouping

The grammar grows at the top (looser levels) and at the bottom (parentheses):

```text
expression → equality
equality   → comparison ( ( "!=" | "==" ) comparison )*
comparison → term ( ( ">" | ">=" | "<" | "<=" ) term )*
term       → factor ( ( "+" | "-" ) factor )*
factor     → unary ( ( "*" | "/" ) unary )*
unary      → ( "!" | "-" ) unary | primary
primary    → NUMBER | STRING | "true" | "false" | "nil"
           | "(" expression ")"
```

`equality` and `comparison` are the same loop shape as `term` and `factor`. Grouping is the
interesting one: inside the parentheses, `primary` calls `expression` again, all the way back
at the loosest level. That's how `(1 + 2) * 3` works. The `+` is inside a primary, so `factor`
sees the whole group as one operand.

### Custom error classes

You can extend `Error` to make your own error type that carries extra data:

```ts
class HttpError extends Error {
  override readonly name = "HttpError";
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
```

- `super(message)` must run before you touch `this`. It sets `message` and the stack trace.
- `name` is what appears in front of the message when the error is printed
  (`HttpError: Not found`). `Error` already has a `name` property, so we're *overriding* it.
- `status` is a new field. Whoever catches the error can read it.

wyrm's `ParseError` carries a whole `Diagnostic`.

### `override` and `noImplicitOverride`

`tsconfig.json` turns on `noImplicitOverride`. With it, redefining a member that the parent
class already has *requires* the `override` keyword:

```ts
class A { greet(): string { return "hi"; } }
class B extends A {
  greet(): string { return "yo"; }          // error TS4114: must have an 'override' modifier
}
class C extends A {
  override great(): string { return "yo"; } // error TS4117: not declared in the base class
}
```

The keyword catches mistakes in both directions. You can't override something by accident, and
if you misspell the name you meant to override, the compiler tells you. `override` is erased
when the types are stripped, so it's fine under `erasableSyntaxOnly`.

### `catch (error)` gives you `unknown`

JavaScript lets you `throw` anything: an `Error`, a string, `42`, `undefined`. So when you
catch, TypeScript can't know what you've got. Under `strict`, the option
`useUnknownInCatchVariables` types the catch variable as `unknown`:

```ts
try {
  risky();
} catch (error) {
  error.message;                 // error TS18046: 'error' is of type 'unknown'.
  if (error instanceof HttpError) {
    error.status;                // fine: narrowed to HttpError
  }
}
```

`instanceof` is a narrowing check, like `typeof`, but for classes. Inside the `if`, `error`
is a `HttpError`.

The rule that follows: **catch only what you expect, and rethrow everything else.** If the
parser has a real bug (say, `peek()` runs past the end), that plain `Error` must not be turned
into a user-facing "syntax error". It should crash loudly, so you find the bug.

### Throw inside, `Result` at the boundary

In lesson 03 the scanner returned a `Result`. The parser does too, but it gets there
differently. Inside the parser, an error is found ten method calls deep, in `primary()`. If
every method returned a `Result`, every call site would need an `if (!r.ok) return r;`.
That's noisy, and it's easy to forget one.

So the parser **throws** a `ParseError` internally, and one small exported function catches it
and turns it into a `Result`:

```ts
export function parseThing(input: string): Result<Thing, Diagnostic[]> {
  try {
    return ok(new ThingParser(input).parse());
  } catch (error) {
    if (error instanceof ThingError) return err([error.diagnostic]);
    throw error;
  }
}
```

The trade-off:

- **Gain:** the grammar methods stay short and read like the grammar. Unwinding ten calls at
  once is exactly what exceptions are good at.
- **Cost:** the method signatures don't say "this can fail". `primary(): Expr` looks total, but
  it isn't. That's why the throwing is kept *private* to the module. Callers outside only ever
  see `Result`, so they're forced to handle failure.
- **Cost for now:** the first error stops everything, so you get one diagnostic. When wyrm has
  statements (lesson 12), the parser will catch at each statement and keep going. The
  `Diagnostic[]` type is already ready for that.

That's also why `Parser` stops being exported this lesson. The class is an implementation
detail, and the public API is `parseExpression(tokens)`.

### `exactOptionalPropertyTypes`: absent is not `undefined`

`Diagnostic` gains an optional field: `at?: string`, the lexeme the error was found at.
Normally `at?: string` accepts both "no `at` property" and `at: undefined`. With
`exactOptionalPropertyTypes` (on in our `tsconfig.json`), only the first is allowed:

```ts
interface Opts { label?: string }
const a: Opts = {};                  // fine: property absent
const b: Opts = { label: "x" };      // fine
const c: Opts = { label: undefined };// error TS2375: … with 'exactOptionalPropertyTypes: true'
```

Why bother? Because `"label" in c` and `Object.keys(c)` treat an absent property and an
`undefined` one differently, and so does `assert.deepEqual`. The flag makes "absent" mean
absent. It restricts *writing*; reading `c.label` still gives `string | undefined`. Lesson 09
relies on that when it checks `d.at === undefined`.

In wyrm: scanner diagnostics simply have no `at`. Parser diagnostics always have one.

## Tests first

Replace the **whole** `test/parser.test.ts` with this. The first five tests are the same as
lesson 07; what changes is the imports, the two helpers, and five new tests at the end.

### `test/parser.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Diagnostic } from "../src/diagnostic.ts";
import { parseExpression } from "../src/parser.ts";
import { printExpr } from "../src/printer.ts";
import { scan } from "../src/scanner.ts";

function parse(source: string): string {
  const scanned = scan(source);
  assert.ok(scanned.ok);
  const parsed = parseExpression(scanned.value);
  if (!parsed.ok) assert.fail(`unexpected errors: ${JSON.stringify(parsed.error)}`);
  return printExpr(parsed.value);
}

function parseErrors(source: string): Diagnostic[] {
  const scanned = scan(source);
  assert.ok(scanned.ok);
  const parsed = parseExpression(scanned.value);
  if (parsed.ok) assert.fail(`expected errors, got ${printExpr(parsed.value)}`);
  return parsed.error;
}

test("literals", () => {
  assert.equal(parse("42"), "42");
  assert.equal(parse('"hi"'), '"hi"');
  assert.equal(parse("true"), "true");
  assert.equal(parse("nil"), "nil");
});

test("unary operators nest", () => {
  assert.equal(parse("--1"), "(- (- 1))");
  assert.equal(parse("!true"), "(! true)");
});

test("* binds tighter than +", () => {
  assert.equal(parse("1 + 2 * 3"), "(+ 1 (* 2 3))");
  assert.equal(parse("1 * 2 + 3"), "(+ (* 1 2) 3)");
});

test("binary operators are left-associative", () => {
  assert.equal(parse("1 - 2 - 3"), "(- (- 1 2) 3)");
  assert.equal(parse("8 / 4 / 2"), "(/ (/ 8 4) 2)");
});

test("unary binds tighter than binary", () => {
  assert.equal(parse("-1 * 2"), "(* (- 1) 2)");
});

test("comparison and equality", () => {
  assert.equal(parse("1 < 2 == true"), "(== (< 1 2) true)");
  assert.equal(parse("1 + 1 >= 2"), "(>= (+ 1 1) 2)");
  assert.equal(parse("!true != false"), "(!= (! true) false)");
});

test("grouping overrides precedence", () => {
  assert.equal(parse("(1 + 2) * 3"), "(* (group (+ 1 2)) 3)");
});

test("missing operand", () => {
  assert.deepEqual(parseErrors("1 +"), [
    { line: 1, col: 4, message: "Expect expression.", at: "end" },
  ]);
});

test("unclosed group", () => {
  assert.deepEqual(parseErrors("(1 + 2"), [
    { line: 1, col: 7, message: "Expect ')' after expression.", at: "end" },
  ]);
});

test("leftover tokens", () => {
  assert.deepEqual(parseErrors("1 2"), [
    { line: 1, col: 3, message: "Expect end of expression.", at: "'2'" },
  ]);
});
```

Look at the two helpers. `parse` expects success: `if (!parsed.ok) assert.fail(…)`. Since
`assert.fail` returns `never`, TypeScript knows `parsed.ok` is `true` after that line.
`parseErrors` is the mirror image. Both give a readable message when the result is the wrong
kind.

Check the columns in the error tests. In `1 +` the `eof` token sits at column 4, just past the
last character, and its `at` is `"end"` because `eof` has no lexeme worth quoting. In `1 2`,
the leftover `2` is at column 3 and its `at` includes the quotes: `"'2'"`.

Run both:

```sh
npm test
npm run typecheck
```

`npm test`: `SyntaxError: The requested module '../src/parser.ts' does not provide an export
named 'parseExpression'`. The whole file fails to load, so it shows up as one failure while the
other 17 tests pass. `npm run typecheck`: `error TS2305: Module '"../src/parser.ts"' has no
exported member 'parseExpression'.` Node found the problem while *linking* modules, and `tsc`
found it while *checking* them.

## The code

### `src/diagnostic.ts`

Do this first, because the parser needs it. Find this:

```ts
  readonly message: string;
}
```

Replace it with:

```ts
  readonly message: string;
  /** The lexeme the error was found at, e.g. "')'" or "end". */
  readonly at?: string;
}
```

The `/** … */` comment is a doc comment. Your editor shows it when you hover over `at`
anywhere in the project.

### `src/parser.ts`

The changes are spread all over the file, so **replace the whole file** with this. The
helpers at the bottom (`match` through `previous`) are unchanged. Everything else, read the
walkthrough.

```ts
import type { Expr } from "./ast.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { err, ok, type Result } from "./result.ts";
import type { Token, TokenType } from "./token.ts";

export function parseExpression(tokens: readonly Token[]): Result<Expr, Diagnostic[]> {
  const parser = new Parser(tokens);
  try {
    return ok(parser.parseExpression());
  } catch (error) {
    if (error instanceof ParseError) return err([error.diagnostic]);
    throw error;
  }
}

class ParseError extends Error {
  override readonly name = "ParseError";
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

class Parser {
  private readonly tokens: readonly Token[];
  private current = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  parseExpression(): Expr {
    const expr = this.expression();
    if (!this.isAtEnd()) throw this.error(this.peek(), "Expect end of expression.");
    return expr;
  }

  private expression(): Expr {
    return this.equality();
  }

  private equality(): Expr {
    let expr = this.comparison();
    while (this.match("!=", "==")) {
      const operator = this.previous();
      const right = this.comparison();
      expr = { kind: "binary", left: expr, operator, right };
    }
    return expr;
  }

  private comparison(): Expr {
    let expr = this.term();
    while (this.match(">", ">=", "<", "<=")) {
      const operator = this.previous();
      const right = this.term();
      expr = { kind: "binary", left: expr, operator, right };
    }
    return expr;
  }

  private term(): Expr {
    let expr = this.factor();
    while (this.match("+", "-")) {
      const operator = this.previous();
      const right = this.factor();
      expr = { kind: "binary", left: expr, operator, right };
    }
    return expr;
  }

  private factor(): Expr {
    let expr = this.unary();
    while (this.match("*", "/")) {
      const operator = this.previous();
      const right = this.unary();
      expr = { kind: "binary", left: expr, operator, right };
    }
    return expr;
  }

  private unary(): Expr {
    if (this.match("!", "-")) {
      const operator = this.previous();
      const right = this.unary();
      return { kind: "unary", operator, right };
    }
    return this.primary();
  }

  private primary(): Expr {
    if (this.match("false")) return { kind: "literal", value: false };
    if (this.match("true")) return { kind: "literal", value: true };
    if (this.match("nil")) return { kind: "literal", value: null };
    if (this.match("number", "string")) {
      return { kind: "literal", value: this.previous().literal };
    }
    if (this.match("(")) {
      const expression = this.expression();
      this.consume(")", "Expect ')' after expression.");
      return { kind: "grouping", expression };
    }
    throw this.error(this.peek(), "Expect expression.");
  }

  // ---- helpers ----

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }

  private error(token: Token, message: string): ParseError {
    const at = token.type === "eof" ? "end" : `'${token.lexeme}'`;
    return new ParseError({ line: token.line, col: token.col, message, at });
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === "eof";
  }

  private peek(): Token {
    const token = this.tokens[this.current];
    if (token === undefined) throw new Error("Parser ran past the end of the tokens.");
    return token;
  }

  private previous(): Token {
    const token = this.tokens[this.current - 1];
    if (token === undefined) throw new Error("No previous token.");
    return token;
  }
}
```

### Walking through it

**Imports.** `Diagnostic` is only used as a type, so it's `import type`. `err` and `ok` are
real functions called at runtime, so they're a normal import. `Result` comes along inline as
`type Result`. That's the same pattern the scanner uses.

**`parseExpression(tokens)`.** This is the boundary described in Concepts. It's the only
export. It uses `ParseError` and `Parser`, which are declared *below* it. That's fine: classes
can't be used before their declaration runs, but this function body only runs when someone
calls it, long after the whole module has loaded.

**`ParseError`.** `override readonly name = "ParseError";` replaces `Error`'s `name`. Because
it's `readonly` and initialised with a string, its type is the literal `"ParseError"`, which
is still a `string`, so it's a valid override. `super(diagnostic.message)` gives the error a
normal `message` too, so if one ever escapes uncaught, the crash still says something useful.

**`Parser.parseExpression()`.** After parsing one expression, the parser must be at `eof`. If
it isn't, like in `1 2`, there are leftover tokens, and that's an error. Without this check,
`1 2` would quietly parse as `1`.

**`throw this.error(…)`.** `error()` *builds* a `ParseError` and returns it. The caller does
the throwing. So every place that fails has a visible `throw` keyword, and TypeScript sees it
too: `primary()` must return an `Expr` on every path, and a `throw` counts as a way out.

**`error(token, message)`.** Picks the `at` text. `eof` has an empty lexeme, so it says
`"end"`. Every other token gets its lexeme in quotes. `at` is always a string here, never
`undefined`, which keeps `exactOptionalPropertyTypes` happy.

**`equality()` and `comparison()`.** Same loop as `term()`, one level looser each.
`expression()` now starts at `equality()`.

**Grouping in `primary()`.** After `(`, parse a full `expression()`, then *require* a `)`.

**`consume(type, message)`.** "The next token must be `type`." If it is, consume and return it;
otherwise throw with the given message. The `)` check is its first use; there will be many more
once there are statements.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing. Then:

```
ℹ tests 27
ℹ pass 27
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Add comparisons, grouping and parse errors"
```

## Study Drills

1. Delete `override` from `ParseError`'s `name` and run `npm run typecheck`. Read the error
   code and message. Then put it back and add `override` to `diagnostic` instead. Read that
   error too. Undo both.
2. In `parseExpression(tokens)`, remove the `instanceof` check so the `catch` always returns
   `err([error.diagnostic])`. Run `npm run typecheck`. Which option is responsible for the
   error? Then undo it.
3. In `error()`, make `at` be `undefined` for `eof` instead of `"end"`. Run
   `npm run typecheck` and read the whole message: it names `exactOptionalPropertyTypes`.
   What would you have to change in `Diagnostic` to allow it, and why would that be worse?
   Undo it.
4. Temporarily delete the `if (!this.isAtEnd())` line in `Parser.parseExpression()`. Which
   test fails, and what does `1 2` parse to now? Undo it.
5. Optional extension: add a test that `((1))` prints as `(group (group 1))`, and one that
   `(` alone reports `Expect expression.` at `end` with the right column. Work out the column
   before you run it. Once they pass, delete them so your test file matches the lesson.
6. Explain in your own words why the parser throws internally but returns a `Result` from
   `parseExpression`. What would the grammar methods look like if they returned `Result`
   instead?

## Checkpoint

Tell Claude: **"lesson 08 done"**. Expect questions like: *Why is `error` typed `unknown` in a
`catch`? Why rethrow errors that aren't `ParseError`? What does `noImplicitOverride` protect
you from? Why can't you write `at: undefined` in a `Diagnostic`?*
