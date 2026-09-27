# Lesson 03 — Scanner I

## Goal

Build the first half of the **scanner**: the part that turns source text into tokens for
punctuation, operators, and comments, skips whitespace, and remembers where each token
starts (**line** and **column**). Strings, numbers, and words come in lesson 04.

The scanner doesn't throw when it sees a bad character. It records a **diagnostic** and
carries on, so one run can report every problem at once. It returns either the tokens or
the diagnostics, and the type says which one you got.

## Concepts

### Classes with explicit fields

You know classes, `private`, and `readonly`. One thing is different here. In a lot of
TypeScript code you'll see **parameter properties**:

```ts
class Point {
  constructor(private readonly x: number) {}   // declares AND assigns this.x
}
```

That shortcut *generates* code (the hidden `this.x = x`). Node's type stripper can only
delete types, it can't generate anything, so `erasableSyntaxOnly` forbids it. We write the
field and the assignment by hand:

```ts
class Point {
  private readonly x: number;

  constructor(x: number) {
    this.x = x;
  }
}
```

Fields can also have initialisers. The type is then inferred from the value:

```ts
class Counter {
  private count = 0;              // number
  private readonly seen: string[] = [];
}
```

Always annotate an empty array. On its own, `[]` in a field is inferred as `never[]`, an
array you can't put anything into.

`private` and `readonly` are TypeScript-only checks. They're stripped at runtime, so they
protect you from *yourself* at compile time, and that's all we need them for.

### Discriminated unions and a generic `Result<T, E>`

A function that can fail has two kinds of answer. Instead of throwing, we can return an
object that says which kind it is:

```ts
type Parsed =
  | { ok: true; value: number }
  | { ok: false; error: string };

function show(p: Parsed): string {
  if (p.ok) {
    return `got ${p.value}`;    // here p is the first member
  }
  return `failed: ${p.error}`;  // here p is the second member
}
```

`ok` is the **discriminant**: a property whose literal type (`true` or `false`) differs
between members. Checking it narrows the whole object, so `p.value` only exists where
`p.ok` is `true`.

Make it **generic** and you can reuse it for any value and error type:

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

const good: Result<number, string> = { ok: true, value: 42 };
```

`T` and `E` are type parameters, placeholders that you fill in when you use the type.
wyrm's scanner returns `Result<Token[], Diagnostic[]>`: either a list of tokens or a list of
diagnostics.

### `never`: the empty type

`never` is the type with **no values at all**. No value can ever have type `never`. That
sounds useless, but it has a handy property: because there's nothing *in* it, `never` is
assignable to every other type. (Every value of type `never` is also a `string`, a number,
anything, trivially, because there are no values to check.)

We'll write small helpers to build results:

```ts
function ok<T>(value: T): Result<T, never> { … }
function err<E>(error: E): Result<never, E> { … }
```

`ok(tokens)` knows its value type, but it has no idea what the error type will be. Saying
`never` means "this result can't hold an error at all". And because `never` fits anywhere,
`Result<Token[], never>` is assignable to `Result<Token[], Diagnostic[]>`, or to
`Result<Token[], anything>`. The same goes for `err`. So one expression can mix them:

```ts
return failed ? err(problems) : ok(tokens);   // fits Result<Token[], Diagnostic[]>
```

Why not give `ok` an `E` type parameter too? Sometimes TypeScript can guess `E` from the
surrounding code (for example from a function's declared return type). But in
`const r = ok(tokens);` there's nothing to guess from, so it picks `unknown`, and a
`Result<Token[], unknown>` does *not* fit `Result<Token[], Diagnostic[]>` later. With
`never` there's nothing to guess: it fits everywhere.

### A function in front, a class behind

The scanner has a lot of state that changes as it goes (the current position, the line, the
tokens so far). A class is a good home for that state. But callers don't need to know
about it. They want one call: source in, result out. So `scanner.ts` exports only a
function:

```ts
export function scan(source: string): … {
  return new Scanner(source).scanTokens();
}

class Scanner { … }   // not exported: private to this module
```

A new `Scanner` is created for each call and thrown away afterwards, so no state leaks
between two scans. And since the class isn't exported, nothing outside the module can
depend on its methods, which means we can change them freely.

`scan` uses `Scanner` above the line where the class is declared. That's fine: the
function body only runs when someone calls `scan`, and by then the whole module has loaded.

### `switch` narrows strings

```ts
function describe(c: string): "open" | "close" | "other" {
  switch (c) {
    case "(": case "[":
      return "open";          // here c is "(" | "["
    case ")": case "]":
      return "close";
    default:
      return "other";         // here c is just string
  }
}
```

Inside a `case`, TypeScript knows `c` equals one of the listed literals, so its type
narrows to exactly those. The scanner relies on this: after `case "(": case ")": …`, the
character `c` *is* a valid `TokenType`, and can be passed straight to a function that
wants one. Stacked empty cases like `case "(": case "[":` are allowed under
`noFallthroughCasesInSwitch`. Only a case *with code* has to end in `break` or `return`.

### Mixed imports: `import { x, type Y }`

`verbatimModuleSyntax` requires type-only imports to be marked, so the stripper can delete
them. When one import brings in both values and types, mark each type inline:

```ts
import { readFile, type Stats } from "node:fs";
```

`import type { … }` marks the whole statement. Use it when *everything* in it is a type.

## Tests first

Create `test/scanner.test.ts`.

### `test/scanner.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/scanner.ts";
import type { TokenType } from "../src/token.ts";

function types(source: string): TokenType[] {
  const result = scan(source);
  if (!result.ok) {
    assert.fail(`unexpected errors: ${JSON.stringify(result.error)}`);
  }
  return result.value.map((t) => t.type);
}

test("empty source is just eof", () => {
  assert.deepEqual(types(""), ["eof"]);
});

test("single-character tokens", () => {
  assert.deepEqual(types("(){},;+-*/"), [
    "(", ")", "{", "}", ",", ";", "+", "-", "*", "/", "eof",
  ]);
});

test("one-or-two character tokens", () => {
  assert.deepEqual(types("! != = == < <= > >="), [
    "!", "!=", "=", "==", "<", "<=", ">", ">=", "eof",
  ]);
});

test("comments and whitespace are skipped", () => {
  assert.deepEqual(types("  ( // everything here is ignored ) \n )"), ["(", ")", "eof"]);
});

test("tokens remember line and column", () => {
  const result = scan("(\n  )");
  assert.ok(result.ok);
  const [open, close] = result.value;
  assert.deepEqual([open?.line, open?.col], [1, 1]);
  assert.deepEqual([close?.line, close?.col], [2, 3]);
});

test("unexpected characters are all reported", () => {
  const result = scan("( @ ) #");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, [
    { line: 1, col: 3, message: "Unexpected character '@'." },
    { line: 1, col: 7, message: "Unexpected character '#'." },
  ]);
});
```

A few things here are worth reading slowly:

- `types()` is a helper that most tests use. They only care about the token *types*.
- `assert.fail(…)` has the return type `never`: it always throws, it never returns. So after
  the `if`, TypeScript knows `result.ok` must be `true`, and `result.value` is allowed.
- `assert.ok(result.ok)` narrows too. It's an *assertion function*: if it returns at all,
  its argument was truthy. (Lesson 11 shows how to write your own.)
- `assert.equal(result.ok, false)` does **not** narrow. That's why the next line is
  `if (result.ok) return;`: at runtime it never returns early, since the assert would already
  have thrown, but it convinces the compiler that `result.error` exists.
- `const [open, close] = result.value` gives `Token | undefined` for each, because of
  `noUncheckedIndexedAccess`, so we write `open?.line`.
- `"(\n  )"`: the `)` is on line 2, after two spaces, so column 3. Columns start at 1.
- In `"( @ ) #"` both bad characters are reported, in order, with their own columns.
  The scanner doesn't stop at the first one.

Run both:

```sh
npm test
npm run typecheck
```

`npm test` shows `ERR_MODULE_NOT_FOUND` for `src/scanner.ts`, and `tests 3`, `pass 2`,
`fail 1`: the two token tests still pass, and the scanner test file fails as a whole.
`tsc` reports `TS2307: Cannot find module '../src/scanner.ts'` and also
`TS7006: Parameter 't' implicitly has an 'any' type`. That second one is a knock-on error:
without `scan`'s type, the compiler can't know what `t` is. Fix the first error in a list
and the others often go away.

## The code

Three new files. Two small ones first.

### `src/diagnostic.ts`

```ts
export interface Diagnostic {
  readonly line: number;
  readonly col: number;
  readonly message: string;
}
```

This gets its own file because the parser and resolver will produce diagnostics too.

### `src/result.ts`

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

`{ ok: true, value }` is shorthand for `{ ok: true, value: value }`. TypeScript checks the
object against the declared return type, so `ok: true` is kept as the literal `true` and not
widened to `boolean`.

Now the scanner. It's a new file, so here it is in full. Type it, then read the notes below it.

### `src/scanner.ts`

```ts
import type { Diagnostic } from "./diagnostic.ts";
import { err, ok, type Result } from "./result.ts";
import type { Literal, Token, TokenType } from "./token.ts";

export function scan(source: string): Result<Token[], Diagnostic[]> {
  return new Scanner(source).scanTokens();
}

class Scanner {
  private readonly source: string;
  private readonly tokens: Token[] = [];
  private readonly errors: Diagnostic[] = [];

  private start = 0;
  private current = 0;
  private line = 1;
  private col = 1;
  private startLine = 1;
  private startCol = 1;

  constructor(source: string) {
    this.source = source;
  }

  scanTokens(): Result<Token[], Diagnostic[]> {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.startLine = this.line;
      this.startCol = this.col;
      this.scanToken();
    }
    this.tokens.push({ type: "eof", lexeme: "", literal: null, line: this.line, col: this.col });
    return this.errors.length > 0 ? err(this.errors) : ok(this.tokens);
  }

  private scanToken(): void {
    const c = this.advance();
    switch (c) {
      case "(": case ")": case "{": case "}":
      case ",": case ";": case "+": case "-": case "*":
        this.addToken(c);
        break;
      case "!": this.addToken(this.match("=") ? "!=" : "!"); break;
      case "=": this.addToken(this.match("=") ? "==" : "="); break;
      case "<": this.addToken(this.match("=") ? "<=" : "<"); break;
      case ">": this.addToken(this.match("=") ? ">=" : ">"); break;
      case "/":
        if (this.match("/")) {
          while (this.peek() !== "\n" && !this.isAtEnd()) this.advance();
        } else {
          this.addToken("/");
        }
        break;
      case " ": case "\r": case "\t": case "\n":
        break;
      default:
        this.error(`Unexpected character '${c}'.`);
    }
  }

  private isAtEnd(): boolean {
    return this.current >= this.source.length;
  }

  private advance(): string {
    const c = this.source.charAt(this.current);
    this.current++;
    if (c === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  private match(expected: string): boolean {
    if (this.peek() !== expected) return false;
    this.advance();
    return true;
  }

  private peek(): string {
    return this.source.charAt(this.current);
  }

  private addToken(type: TokenType, literal: Literal = null): void {
    const lexeme = this.source.slice(this.start, this.current);
    this.tokens.push({ type, lexeme, literal, line: this.startLine, col: this.startCol });
  }

  private error(message: string): void {
    this.errors.push({ line: this.startLine, col: this.startCol, message });
  }
}
```

**The fields.** `source` is set once in the constructor, so it's `readonly`. `tokens` and
`errors` are `readonly` too. That means the *field* can't be pointed at a different array,
but we can still `push` into the array. The six position fields change all the time, so
they're plain `private`. Their types are inferred as `number` from the initialisers.

**Positions.** `start` and `current` are indexes into `source`: `start` is where the token
being scanned began, and `current` is the next character to read. `line` and `col` follow
`current`. `startLine` and `startCol` are copied at the start of each token, because by
the time a token is finished, `line` and `col` have moved past it. Tokens and diagnostics
always report where they *start*.

**`scanTokens()`** loops one token at a time until the end, then adds the `eof` token at the
final position. The last line is the `never` trick from the Concepts: the two branches have
different types, and both fit the declared return type.

**`scanToken()`** reads one character and decides what it starts:

- In the first group, `c` has been narrowed to a union of those nine literals, and every one
  of them is a `TokenType`. That's why `this.addToken(c)` type-checks even though `advance()`
  returns `string`. Note that `/` is not in this group. It gets its own case.
- For `!`, `=`, `<` and `>`, `match("=")` looks at the *next* character and eats it only if
  it's `=`. So `!=` becomes one token, not two.
- `//` starts a comment that runs to the end of the line. The loop stops *before* the `\n`,
  so the newline is handled by the next `scanToken()` and `line` gets incremented as usual.
- Whitespace produces no token at all.
- Anything else is recorded with `error()`, and the loop carries on with the next character.

**`advance()`** is the only method that moves forward, so it's the only one that updates
`line` and `col`. After a newline the column goes back to 1.

**`peek()`** looks at the current character without consuming it. `charAt` returns `""`
when you're past the end, so `peek()` always returns a `string`. Lesson 04 explains why that
matters.

**`addToken()`** takes the lexeme straight out of the source, from `start` to `current`. The
`literal: Literal = null` parameter has a default value. Every token in this lesson uses the
default. Lesson 04 passes real literal values.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
✔ empty source is just eof (1.3ms)
✔ single-character tokens (0.3ms)
✔ one-or-two character tokens (0.2ms)
✔ comments and whitespace are skipped (0.2ms)
✔ tokens remember line and column (0.2ms)
✔ unexpected characters are all reported (0.2ms)
✔ every keyword is recognised (0.9ms)
✔ identifiers are not keywords (0.2ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Scan punctuation, operators and comments"
```

## Study Drills

1. Rewrite `Scanner`'s constructor to use a parameter property for `source` (and remove the
   field declaration). Run `npm run typecheck` and read the error code and message. Then run
   `npm test`: does it still pass? Undo it.
2. Remove the `: Token[]` annotation from the `tokens` field, keeping `= []`. Read the error.
   Which type does TypeScript give the field, and why can nothing be pushed into it? Undo it.
3. Add `"@"` to the first stacked `case` group. Read the error on `this.addToken(c)`: it
   lists the exact type of `c` on that line. Explain why that's the type. Undo it.
4. Explain in your own words why `ok` returns `Result<T, never>`. Then test your
   explanation: temporarily give `ok` a second type parameter `E` and return `Result<T, E>`.
   Run the type checker. The scanner still compiles: find out why (hint: look at where
   `ok(this.tokens)` is used). Now add two throwaway exported constants to `result.ts`: one
   set to `ok(1)` with no annotation, and one of type `Result<number, string>` set to the
   first. Read the error, and find what TypeScript inferred for `E`. Undo everything.
5. Before running anything, predict the line and column of the `eof` token for the source
   `"(\n  )"`. Check your answer with a temporary `console.log` in a test. Remove it.
6. Try to import `Scanner` in the test file. Read both errors, the runtime one and the `tsc`
   one. Undo it.

## Checkpoint

Tell Claude: **"lesson 03 done"**. Expect questions like: *Why can't wyrm use constructor
parameter properties? What is `never`, and why is `Result<T, never>` assignable to
`Result<T, Diagnostic[]>`? Why does `this.addToken(c)` type-check when `advance()` returns a
`string`? Why do tokens store `startCol` and not `col`?*
