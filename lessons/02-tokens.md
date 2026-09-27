# Lesson 02 — Tokens

## Goal

Define what a **token** is: the vocabulary every later part of wyrm speaks. The scanner (next
lesson) will turn source text into a list of tokens, and the parser will read that list.
This lesson has no scanning yet. It's only types, plus one function that answers "is this
word a keyword?".

You'll also delete the `greet` files from lesson 01. They did their job.

## Concepts

### Literal types and literal unions

In TypeScript, a single string value can be a type:

```ts
type Up = "up";               // the only value of this type is "up"
type Direction = "up" | "down" | "left" | "right";

let d: Direction = "up";      // fine
d = "sideways";               // error: not assignable to type 'Direction'
```

A union of string literals does the job an `enum` does in other languages. wyrm can't use
`enum` anyway: `erasableSyntaxOnly` forbids it, because an `enum` produces a runtime object
and so can't simply be stripped away (see [ADR 0001](../docs/adr/0001-native-type-stripping.md)).
A literal union is pure type information, so Node deletes it and nothing is left behind.

wyrm's `TokenType` is one big literal union. Punctuation tokens use the character itself as
their type (`"("`, `"+"`, `">="`), and every keyword uses the word itself (`"let"`, `"fn"`).

### `as const`

TypeScript widens values when it guesses their types:

```ts
const sizes = ["s", "m", "l"];            // string[]
const sizes2 = ["s", "m", "l"] as const;  // readonly ["s", "m", "l"]
```

`as const` says: "take this value literally". The array becomes a **readonly tuple** whose
elements have literal types. It is not a cast. It doesn't overrule the compiler, it asks
for a *narrower* type, and that's why the course allows it.

### Getting a type out of a value: `(typeof X)[number]`

We want the list of keywords to exist **twice**: as a runtime array (to check words against)
and as a type (so the compiler knows `"while"` is a keyword). Writing both by hand means they
can drift apart. Instead, write the array once and derive the type from it:

```ts
const SIZES = ["s", "m", "l"] as const;
type Size = (typeof SIZES)[number];   // "s" | "m" | "l"
```

Read it inside out:

- `typeof SIZES` in a *type* position means "the type of the value `SIZES`", which is
  `readonly ["s", "m", "l"]`.
- `[number]` indexes that type with *any number*: "what type do I get from `SIZES[someNumber]`?"
  The answer is the union of all element types.

Without `as const`, `typeof SIZES` would be `string[]`, and `Size` would be plain `string`.

### Type predicates: `x is T`

A function returning `boolean` tells the compiler nothing about its argument. A **type
predicate** in the return type does:

```ts
type Vowel = "a" | "e" | "i" | "o" | "u";

function isVowel(c: string): c is Vowel {
  return "aeiou".includes(c) && c.length === 1;
}

const ch: string = "e";
if (isVowel(ch)) {
  const v: Vowel = ch;   // fine: inside the if, ch is Vowel
}
```

At runtime, `isVowel` still returns a plain `true` or `false`. The predicate is a promise
to the compiler: "if I return `true`, the argument is a `Vowel`". The compiler **trusts** it
and doesn't check the body. A predicate that lies is a bug the compiler can't find, so
keep predicate bodies short and obviously right.

wyrm's `isKeyword(word: string): word is Keyword` lets the scanner (lesson 04) turn a
`string` it has read into a `Keyword` without any cast.

### `ReadonlySet<T>`

`ReadonlySet<T>` is the type of a `Set` with the mutating methods (`add`, `delete`, `clear`)
removed. The object at runtime is an ordinary `Set`. The type only stops *you* from changing it.

Why does `isKeyword` use a set at all, instead of `KEYWORDS.includes(word)`? Because that
doesn't type-check. On a readonly tuple of literals, `.includes` only accepts the element
type:

```ts
const SIZES = ["s", "m", "l"] as const;
function isSize(x: string): boolean {
  return SIZES.includes(x);
  // error: Argument of type 'string' is not assignable to parameter of type '"s" | "m" | "l"'.
}
```

The usual workaround, `(SIZES as readonly string[]).includes(x)`, is an `as` cast, which is
banned. So we build a `Set` from the keywords and give it the *wider* type
`ReadonlySet<string>`. Its `.has()` accepts any string, which is exactly the question we
want to ask. It's also a constant-time lookup, although with twelve keywords that hardly
matters.

## Tests first

First, delete lesson 01's files. `greet` isn't part of wyrm.

```sh
rm src/greet.ts test/greet.test.ts
```

Create `test/token.test.ts`.

### `test/token.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isKeyword, KEYWORDS } from "../src/token.ts";

test("every keyword is recognised", () => {
  for (const word of KEYWORDS) {
    assert.equal(isKeyword(word), true);
  }
});

test("identifiers are not keywords", () => {
  assert.equal(isKeyword("dragon"), false);
  assert.equal(isKeyword("Let"), false);
  assert.equal(isKeyword(""), false);
});
```

`"Let"` checks that keywords are case-sensitive. `""` checks the edge case every
string function should survive.

Run both commands:

```sh
npm test
npm run typecheck
```

`npm test` fails with `ERR_MODULE_NOT_FOUND: Cannot find module '…/src/token.ts'`. The test
file can't even load, so node reports the *file* as one failed test (`tests 1`, `fail 1`).
`tsc` says the same thing its own way: `error TS2307: Cannot find module '../src/token.ts'`.

Now create an **empty** `src/token.ts` and run both again. The runtime error changes to
`SyntaxError: The requested module '../src/token.ts' does not provide an export named …`.
The file exists now, but the names don't. `tsc` reports `error TS2305: Module … has no exported
member 'isKeyword'` (and the same for `KEYWORDS`). Same problem, two voices. Learn to recognise both.

## The code

Fill in `src/token.ts`.

### `src/token.ts`

```ts
export const KEYWORDS = [
  "and", "else", "false", "fn", "if", "let",
  "nil", "or", "print", "return", "true", "while",
] as const;

export type Keyword = (typeof KEYWORDS)[number];

export type TokenType =
  // single-character
  | "(" | ")" | "{" | "}" | "," | ";"
  | "+" | "-" | "*" | "/"
  // one or two characters
  | "!" | "!=" | "=" | "==" | "<" | "<=" | ">" | ">="
  // literals
  | "identifier" | "string" | "number"
  // keywords
  | Keyword
  // end of input
  | "eof";

export type Literal = number | string | null;

export interface Token {
  readonly type: TokenType;
  readonly lexeme: string;
  readonly literal: Literal;
  readonly line: number;
  readonly col: number;
}

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

export function isKeyword(word: string): word is Keyword {
  return KEYWORD_SET.has(word);
}
```

Notes:

- The keywords are in alphabetical order, the same list as in `CONTEXT.md`.
- The leading `|` before the first member of `TokenType` is allowed and optional. It lets
  every line look the same, so the comments can group the members.
- `| Keyword` puts a union *inside* a union. TypeScript flattens it: `TokenType` contains
  all twelve keyword strings directly. Add a keyword to `KEYWORDS` and `TokenType` grows by itself.
- `"identifier"`, `"string"`, `"number"` are types of tokens whose text varies: `dragon`,
  `"hi"`, `42`. `"eof"` marks the end of the input, so the parser never runs off the end of the list.
- `Literal` is the *value* a token carries: the number `42` for the lexeme `42`, the string
  `hi` for the lexeme `"hi"`, and `null` for every token that has no value, like `(`.
- Every field of `Token` is `readonly`. Once the scanner makes a token, nothing changes it.
- `new Set(KEYWORDS)` would be inferred as `Set<Keyword>`. The annotation widens it to
  `ReadonlySet<string>` (read-only, and `.has()` takes any string). Giving a value a
  *wider* type like this is allowed. It's the opposite direction, narrowing, that needs proof.
- `KEYWORD_SET` is not exported. It's a detail of this module.

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
✔ every keyword is recognised (0.7ms)
✔ identifiers are not keywords (0.1ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Add token types and keyword check"
```

## Study Drills

1. Add a throwaway exported constant to `token.ts` of type `Keyword`, set to `"dragon"`.
   Run `npm run typecheck` and read the whole error: which type does it list? Now delete
   `as const` from `KEYWORDS` and run it again. The error is gone. Work out what `Keyword`
   has become and why. Put `as const` back and delete the constant.
2. Replace the body of `isKeyword` with a call to `KEYWORDS.includes`. Read the error
   and explain in one sentence why the parameter has that type. Undo it.
3. Change the annotation on `KEYWORD_SET` to `ReadonlySet<Keyword>`. Which line breaks now,
   and why is it the same complaint as drill 2? Undo it.
4. Make `isKeyword` lie: return `true` for every word. Run `npm run typecheck`, then
   `npm test`. Explain in your own words why only one of them notices, and what that says
   about writing type predicates. Undo it.
5. Write a throwaway exported function that takes a `string` and returns
   `Keyword | undefined`: the argument itself if `isKeyword` says yes, otherwise `undefined`.
   It compiles. Change the predicate's return type to plain `boolean` and read the new
   error. Undo everything.

## Checkpoint

Tell Claude: **"lesson 02 done"**. Expect questions like: *What does `as const` change about
the type of an array? Read `(typeof KEYWORDS)[number]` out loud: what does each part do?
What does `word is Keyword` promise, and who checks that promise? Why a `ReadonlySet<string>`
and not `.includes`?*
