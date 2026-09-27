# Lesson 04 — Scanner II

## Goal

Finish the scanner. After this lesson it understands string literals (`"hello"`), number
literals (`42`, `3.14`), identifiers (`dragon_1`), and keywords (`let`, `fn`, …). Tokens for
strings and numbers carry their **literal** value, and keywords get their own token type,
using `isKeyword` from lesson 02.

After this lesson, `scan('if (x >= 10) { print "big"; }')` produces exactly the tokens the
parser will need.

## Concepts

### Default parameters

A parameter can have a default value, used when the caller leaves it out:

```ts
function pad(text: string, width: number = 8): string {
  return text.padEnd(width);
}

pad("hi");       // width is 8
pad("hi", 3);    // width is 3
```

For the caller, `width` is optional. Inside the function it's always a `number`, never
`undefined`, because the default fills the gap. Compare `width?: number`, where the body
would see `number | undefined` and have to deal with it.

`addToken(type: TokenType, literal: Literal = null)` has been in the scanner since lesson 03.
Until now every call used the default. This lesson makes the first calls that pass a real literal.

### Helper functions outside the class

Some helpers don't need any scanner state. "Is this character a digit?" only depends on the
character. Those don't need to be methods: they can be plain functions at module level, below
the class.

```ts
class Report {
  line(n: number): string {
    return isEven(n) ? "even" : "odd";
  }
}

function isEven(n: number): boolean {
  return n % 2 === 0;
}
```

They're not exported, so they're private to the module, just like the `Scanner` class. A
function that takes a value and returns a value, with no `this`, is easier to read and to
test. Function declarations are **hoisted**: the class can call them even though they appear
further down the file.

### `charAt` vs. indexing

With `noUncheckedIndexedAccess`, indexing a string gives `string | undefined`, because the
index might be past the end:

```ts
const s = "abc";
const a = s[5];           // string | undefined (at runtime: undefined)
const b = s.charAt(5);    // string             (at runtime: "")
```

The scanner looks ahead past the end all the time. At the last character, `peekNext()` is
one past the end. With indexing, every `peek()` would need an `undefined` check (or a banned
`!`). `charAt` returns the empty string instead, and `""` is harmless: it isn't a digit, a
letter, a quote, or a newline, so every "keep going while…" loop simply stops. The end of
the input looks like one more character that matches nothing.

### Comparing characters

`c >= "0" && c <= "9"` compares strings by their character codes. For single characters,
that's a range check: `"5"` is between `"0"` and `"9"`, `"a"` isn't. And `""` is smaller than
every other string, so `"" >= "0"` is `false`. The end of input is never a digit.

### A type predicate in a ternary

From lesson 02: `isKeyword(word: string): word is Keyword`. A type predicate narrows in *any*
condition, including a ternary:

```ts
type Size = "s" | "m" | "l";
function isSize(x: string): x is Size {
  return x === "s" || x === "m" || x === "l";
}

function label(x: string): Size | "custom" {
  return isSize(x) ? x : "custom";   // x is Size in the true branch
}
```

The scanner does the same thing with `isKeyword(text) ? text : "identifier"`. In the true
branch `text` is a `Keyword`, and in the false branch the value is the literal
`"identifier"`. So the whole expression has the type `Keyword | "identifier"`, and both are
members of `TokenType`. That's why it can be passed to `addToken` with no cast. Without the
predicate, `text` would be a plain `string` in both branches, and a `string` isn't a `TokenType`.

## Tests first

Add these tests to the **end** of `test/scanner.test.ts`, after the last test, with a blank
line before each. The imports and the `types()` helper stay as they are.

```ts
test("string literals keep their value without quotes", () => {
  const result = scan('"hello wyrm"');
  assert.ok(result.ok);
  const [str] = result.value;
  assert.equal(str?.type, "string");
  assert.equal(str?.lexeme, '"hello wyrm"');
  assert.equal(str?.literal, "hello wyrm");
});

test("unterminated strings are an error", () => {
  const result = scan('"oops');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, [{ line: 1, col: 1, message: "Unterminated string." }]);
});

test("numbers become number literals", () => {
  const result = scan("42 3.14");
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.map((t) => t.literal),
    [42, 3.14, null],
  );
});

test("identifiers and keywords", () => {
  assert.deepEqual(types("let dragon_1 = fn;"), [
    "let", "identifier", "=", "fn", ";", "eof",
  ]);
});

test("keywords are case-sensitive", () => {
  assert.deepEqual(types("Let LET let"), ["identifier", "identifier", "let", "eof"]);
});

test("a small program", () => {
  assert.deepEqual(types('if (x >= 10) { print "big"; }'), [
    "if", "(", "identifier", ">=", "number", ")",
    "{", "print", "string", ";", "}", "eof",
  ]);
});
```

Notes:

- The lexeme of a string token includes the quotes. Its literal doesn't. That's the difference
  between "the text in the source" and "the value it stands for".
- The unterminated string is reported at line 1, column 1, where the string *starts*.
- `[42, 3.14, null]`: the last `null` is the `eof` token's literal.
- `dragon_1` checks that identifiers may contain `_` and digits.
- Single quotes around the TypeScript strings let the wyrm source contain `"` without escaping.

Run both:

```sh
npm test
npm run typecheck
```

This time the red looks different. `npm test` shows `tests 14`, `pass 8`, `fail 6`: the
file loads, and all the new tests fail on their asserts, because the scanner reports every
`"`, digit, and letter as an unexpected character. `npm run typecheck` prints **nothing**.
The tests only use `scan`, which already exists with the right type. The types are right and
the behaviour is wrong, which is exactly the kind of bug only a test can catch.

## The code

All the changes are in `src/scanner.ts`. There are five of them.

### 1. The import

`scanner.ts` now needs `isKeyword`, which is a value, so the line can't be `import type`
any more. Find this:

```ts
import type { Literal, Token, TokenType } from "./token.ts";
```

Replace it with:

```ts
import { isKeyword, type Literal, type Token, type TokenType } from "./token.ts";
```

### 2. New cases in `scanToken()`

Find the end of the `switch` in `scanToken()`:

```ts
      case " ": case "\r": case "\t": case "\n":
        break;
      default:
        this.error(`Unexpected character '${c}'.`);
    }
  }
```

Replace it with:

```ts
      case " ": case "\r": case "\t": case "\n":
        break;
      case '"':
        this.string();
        break;
      default:
        if (isDigit(c)) {
          this.number();
        } else if (isAlpha(c)) {
          this.identifier();
        } else {
          this.error(`Unexpected character '${c}'.`);
        }
    }
  }
```

A quote is one exact character, so it gets a `case`. "Any digit" or "any letter" can't be
written as a `case`, so those checks go in `default`, before falling back to the error.

### 3. Three scanning methods

Add these three methods right after `scanToken()`, before `isAtEnd()`, with a blank line
between methods as everywhere else in the class:

```ts
  private string(): void {
    while (this.peek() !== '"' && !this.isAtEnd()) this.advance();
    if (this.isAtEnd()) {
      this.error("Unterminated string.");
      return;
    }
    this.advance(); // the closing "
    const value = this.source.slice(this.start + 1, this.current - 1);
    this.addToken("string", value);
  }

  private number(): void {
    while (isDigit(this.peek())) this.advance();
    if (this.peek() === "." && isDigit(this.peekNext())) {
      this.advance(); // the "."
      while (isDigit(this.peek())) this.advance();
    }
    const text = this.source.slice(this.start, this.current);
    this.addToken("number", Number(text));
  }

  private identifier(): void {
    while (isAlphaNumeric(this.peek())) this.advance();
    const text = this.source.slice(this.start, this.current);
    this.addToken(isKeyword(text) ? text : "identifier");
  }
```

Each method starts with the first character already consumed by `advance()` in `scanToken()`.

- **`string()`** reads until the closing quote. A string can span several lines: `advance()`
  still counts the newlines. If the input runs out first, that's a diagnostic, and no token
  is added. The value is the lexeme without its first and last characters, the quotes.
- **`number()`** reads digits, then a fraction only if the `.` is followed by a digit. That
  needs *two* characters of lookahead, hence `peekNext()`. `Number(text)` turns the lexeme
  into the literal value. Since `text` only ever contains digits and at most one dot, the
  result is never `NaN`.
- **`identifier()`** reads letters, digits, and underscores, then asks whether the word is a
  keyword. This is the ternary from the Concepts: `text` becomes a `Keyword` in the true branch.

### 4. `peekNext()`

Add this right after `peek()`, before `addToken()`:

```ts
  private peekNext(): string {
    return this.source.charAt(this.current + 1);
  }
```

### 5. The character helpers

Add these at the very end of the file, **after** the closing `}` of the class, with a blank
line before each:

```ts
function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isAlpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isAlphaNumeric(c: string): boolean {
  return isAlpha(c) || isDigit(c);
}
```

`isAlpha` counts `_` as a letter, so identifiers can start with it. Only ASCII letters count:
`é` is an unexpected character in wyrm.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
✔ empty source is just eof (2.0ms)
✔ single-character tokens (0.6ms)
✔ one-or-two character tokens (0.3ms)
✔ comments and whitespace are skipped (0.2ms)
✔ tokens remember line and column (0.4ms)
✔ unexpected characters are all reported (0.4ms)
✔ string literals keep their value without quotes (0.2ms)
✔ unterminated strings are an error (0.1ms)
✔ numbers become number literals (0.1ms)
✔ identifiers and keywords (0.1ms)
✔ keywords are case-sensitive (0.1ms)
✔ a small program (0.1ms)
✔ every keyword is recognised (1.0ms)
✔ identifiers are not keywords (0.2ms)
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Scan strings, numbers and identifiers"
```

## Study Drills

1. Change `peek()` to index the string with square brackets instead of `charAt`. Read the
   error. Then work out what the scanner would do at runtime at the end of the input if the
   error weren't there (what does `isDigit` get?). Undo it.
2. Change the return type of `isKeyword` in `token.ts` to plain `boolean`. Find the one line
   in the scanner that breaks, and explain the error message in terms of what `text` is in
   each branch of the ternary. Undo it.
3. Remove the default `= null` from `addToken`. Count the errors and read one. Where did the
   default save you from writing `null` by hand? Undo it.
4. Predict the result of scanning each of these, then check with a temporary test (delete
   it afterwards): `1.`, `.5`, `x.y`, and a string that contains a newline followed by
   another token. For the last one, which line is the second token on?
5. Explain in your own words why `isDigit` and friends are module-level functions and not
   private methods of `Scanner`. What would you gain or lose either way?

## Checkpoint

Tell Claude: **"lesson 04 done"**. Expect questions like: *Why does the scanner use `charAt`
and not `source[i]`? Why does `isKeyword(text) ? text : "identifier"` type-check as a
`TokenType`? What's the difference between a default parameter and an optional one, from
inside the function? Why did the new tests fail at runtime but not in `tsc`?*
