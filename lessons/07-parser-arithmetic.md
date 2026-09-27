# Lesson 07 — Parser I: arithmetic

## Goal

Turn a list of tokens into an AST. By the end, `1 + 2 * 3` parses to
`(+ 1 (* 2 3))`: the `*` ends up deeper in the tree than the `+`, because it binds tighter.

You'll write a **recursive descent** parser: one method per precedence level, each calling the
next-tighter level. This lesson covers literals, unary `!` and `-`, and the four arithmetic
operators. Lesson 08 adds comparisons, parentheses and proper error reporting.

## Concepts

### A grammar is a table of precedence levels

Before writing a parser, write down the grammar. Each rule is one precedence level, loosest at
the top, tightest at the bottom. Each rule refers only to itself or to the rule below it.

```text
expression → term
term       → factor ( ( "+" | "-" ) factor )*
factor     → unary ( ( "*" | "/" ) unary )*
unary      → ( "!" | "-" ) unary | primary
primary    → NUMBER | STRING | "true" | "false" | "nil"
```

Read `( … )*` as "zero or more times" and `|` as "or". Written as a table:

| Level | Operators | Associativity | Method |
|---|---|---|---|
| term | `+ -` | left | `term()` |
| factor | `* /` | left | `factor()` |
| unary | `! -` (prefix) | right | `unary()` |
| primary | literals | — | `primary()` |

Why does `*` end up deeper in the tree? `term()` can't build anything until `factor()` hands it
a finished operand. So in `1 + 2 * 3`, `factor()` swallows `2 * 3` whole before `term()` gets
to see the `+` again. The tighter the level, the deeper it sits in the call stack, and the
deeper it ends up in the tree.

### Recursive descent: one method per rule

"Recursive descent" means you translate each grammar rule into one method, almost word for
word. A reference to another rule becomes a method call. `( … )*` becomes a `while` loop.
`|` becomes `if`. Here's a tiny grammar for sums of digits:

```ts
// sum → digit ( "+" digit )*
function sum(): number {
  let total = digit();
  while (next === "+") {
    advance();
    total = total + digit();
  }
  return total;
}
```

The method's shape follows the rule's shape. Once you see this, the parser is mostly typing.

### Loops give left associativity

`1 - 2 - 3` must mean `(1 - 2) - 3`, which is `-4`. You could write the rule recursively:

```text
term → factor ( "-" term )?
```

That reads fine, but it groups the other way: `1 - (2 - 3)`, which is `2`. The loop version
instead keeps one variable, `expr`, and wraps it in a new binary node each time around:

```text
expr = 1
see "-", parse 2   → expr = (- 1 2)
see "-", parse 3   → expr = (- (- 1 2) 3)
```

The old tree always becomes the *left* child. That's left associativity. Unary is different:
`--1` is `-(-1)`, so `unary()` really does call itself, and prefix operators group to the
right.

### Rest parameters: `match(...types)`

You met rest parameters in lesson 06 (`parenthesize(name, ...exprs)`). The parser has a helper
that asks "is the next token any of these types?":

```ts
function anyOf(...options: string[]): boolean {
  // options is a real string[] here
  return options.includes("x");
}
anyOf("a");           // options = ["a"]
anyOf("a", "b", "c"); // options = ["a", "b", "c"]
```

`this.match("+", "-")` reads almost like the grammar. The parameter's type is still an array
type (`TokenType[]`), and TypeScript checks every argument against the element type, so
`this.match("+", "plus")` is a type error.

### `peek()` throws instead of using `!`

With `noUncheckedIndexedAccess`, indexing an array gives `T | undefined`:

```ts
const tokens: Token[] = [/* … */];
const t = tokens[3]; // Token | undefined
t.type;              // error: 't' is possibly 'undefined'
```

We *know* the scanner always ends the list with an `eof` token and that the parser never moves
past it. The quick fix is `tokens[3]!`, but `!` is banned: it tells the compiler "trust me",
and if you're wrong, the crash happens somewhere far away with a confusing message. Instead,
check and throw:

```ts
const t = tokens[3];
if (t === undefined) throw new Error("No token 3.");
t.type; // t is Token here
```

It costs one line. If your belief is ever wrong, you get a clear message at the exact spot. And
the compiler narrows `t` to `Token` without being overruled. `peek()` and `previous()` in the
parser do exactly this. If one of those errors ever fires, it's a bug in the parser, not in the
user's wyrm code.

### `readonly Token[]`

The parser only reads the token list. Declaring the field and the parameter as
`readonly Token[]` removes `push`, `pop`, index assignment and the other mutating methods from
the type. The parser *can't* change the tokens by accident. Any `Token[]` can be passed where a
`readonly Token[]` is expected, so callers don't have to do anything special.

### A temporary shortcut

In this lesson the `Parser` class is exported and used directly, and a bad expression makes
`primary()` throw a plain `Error`. That's enough to get precedence right. Lesson 08 replaces
both with a proper error type and a `Result`-returning function.

## Tests first

Create `test/parser.test.ts`:

### `test/parser.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser.ts";
import { printExpr } from "../src/printer.ts";
import { scan } from "../src/scanner.ts";

function parse(source: string): string {
  const scanned = scan(source);
  assert.ok(scanned.ok);
  return printExpr(new Parser(scanned.value).parseExpression());
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
```

The tests don't compare trees directly. They print the tree with `printExpr` from lesson 06
and compare strings. `(+ 1 (* 2 3))` is much easier to read in a failure message than a nested
object.

`assert.ok(scanned.ok)` narrows `scanned` so that `scanned.value` is allowed on the next line.
That's an *assertion function*. You'll write your own in lesson 11.

Run both:

```sh
npm test
npm run typecheck
```

`npm test` fails with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/parser.ts'`.
The file is reported as one failed test, and the 17 tests from earlier lessons still pass.
`npm run typecheck` says `error TS2307: Cannot find module '../src/parser.ts' or its
corresponding type declarations.` Same problem, found by two different tools.

## The code

Create the parser. Type it top to bottom, then read the walkthrough below it.

### `src/parser.ts`

```ts
import type { Expr } from "./ast.ts";
import type { Token, TokenType } from "./token.ts";

export class Parser {
  private readonly tokens: readonly Token[];
  private current = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  parseExpression(): Expr {
    return this.expression();
  }

  private expression(): Expr {
    return this.term();
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
    throw new Error(`Expect expression, got '${this.peek().lexeme}'.`);
  }

  // ---- helpers ----

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

**The fields.** `tokens` is the input. `current` is the index of the next token to look at.
Nothing else is stored: the parser's whole state is "where am I in the list".

**`parseExpression()` and `expression()`.** `parseExpression` is the public entry point.
`expression()` is the top grammar rule. Right now it just forwards to `term()`. It exists so
that lesson 08 can slot a looser level (`equality`) in between without touching anything else.

**`term()` and `factor()`.** These two are the same shape with different operators and a
different next level. `let expr = this.factor();` infers `expr: Expr`. When the loop reassigns
it with `{ kind: "binary", left: expr, operator, right }`, TypeScript checks that object
literal against the `Expr` union. Misspell `kind` or forget `operator` and you get an error on
that line.

`const operator = this.previous();` grabs the token `match` just consumed. `match` moves
forward, so the operator is now *behind* us.

**`unary()`.** If it sees `!` or `-`, it calls *itself* for the operand. That's what makes
`--1` work. Otherwise it drops to `primary()`.

**`primary()`.** The bottom of the grammar. `this.previous().literal` has the type `Literal`
(`number | string | null`), which fits `LiteralValue` (`number | string | boolean | null`).
The scanner put the actual number or string into the token in lesson 04, so the parser just
passes it on. `true`, `false` and `nil` have no literal on their token, so the parser writes
their values itself.

If nothing matches, it throws a plain `Error` for now.

**The helpers.** These are the parser's vocabulary:

- `check(type)` looks at the next token without consuming it.
- `match(...types)` consumes the next token if it's any of the types, and says whether it did.
- `advance()` consumes a token and returns it. It never moves past `eof`.
- `isAtEnd()` is true when the next token is `eof`.
- `peek()` and `previous()` read the tokens at `current` and `current - 1`, with the guard
  described in Concepts.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing. Then the test run ends with:

```
ℹ tests 22
ℹ pass 22
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Parse arithmetic with recursive descent"
```

## Study Drills

1. In `peek()`, delete the `undefined` check and just `return this.tokens[this.current];`.
   Run `npm run typecheck` and read the whole error. Which compiler option causes it? Then undo
   it.
2. Remove the `...` from `match`'s parameter. Run `npm run typecheck`. You get two different
   error codes. Explain what each one means. Then undo it.
3. Temporarily make `expression()` call `factor()` instead of `term()`. Run `npm test` and
   look at what `parse("1 + 2 * 3")` returns now. Where did `+ 2 * 3` go? Why didn't the parser
   complain? (Lesson 08 fixes this.) Then undo it.
4. On paper, trace `-1 * 2 + 3`: write the call stack (`expression → term → factor → …`) and
   note each time a token is consumed. Check your final tree against the parser.
5. Add a temporary test that parses `1 +`. Run it and read the failure. What kind of error is
   it, and would a wyrm user find the message useful? Then delete the test.
6. Explain in your own words why a `while` loop gives left associativity and a
   self-recursive call gives right associativity.

## Checkpoint

Tell Claude: **"lesson 07 done"**. Expect questions like: *Why does `*` end up deeper in the
tree than `+`? What would `1 - 2 - 3` evaluate to if `term` were right-associative? Why does
`peek()` throw instead of using `!`? What does `readonly Token[]` stop you from doing?*
