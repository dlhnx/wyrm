# wyrm 🐉 — Learn TypeScript the Hard Way

You will build **wyrm**, a small programming language, in TypeScript — by hand.

```
fn makeCounter() {
  let count = 0;
  fn inc() { count = count + 1; return count; }
  return inc;
}
let counter = makeCounter();
print counter(); // 1
print counter(); // 2
```

By the end you'll have a scanner, a parser, a tree-walking interpreter with closures,
native functions, a REPL, a file runner, and a static resolver pass — and you will have
typed every line of it yourself.

## The rules

1. **Type everything by hand.** No copy-paste. Not even once. Typing is how the syntax
   gets into your fingers, and the typos you make are how you learn to read compiler errors.
2. **Tests first.** Every lesson gives you the tests before the code. Type the tests,
   run them, *watch them fail*, then type the code and watch them pass.
3. **Zero runtime dependencies.** The only packages are `typescript` and `@types/node`,
   and both are dev-only. Tests use Node's built-in `node:test`.
4. **The strictest compiler we can get.** See `tsconfig.json` in lesson 01.
5. **Banned (unless a lesson says otherwise):**
   - `any` — use `unknown` and narrow it.
   - `as` casts — if the compiler disagrees with you, *convince* it (narrowing, type guards),
     don't overrule it. (`as const` is allowed: it's not a cast, it makes a type *narrower*.)
   - `!` non-null assertions — handle the `undefined` case.
6. **Study Drills are not optional.** Every lesson ends with drills that give you *no code*.
   A lesson is done when the tests pass **and** the drills are done.
7. **When you get stuck:** read the error message out loud, all of it. Then re-read the
   lesson. Then compare your code with the lesson character by character. Then ask.

## How a lesson works

Each lesson in `lessons/` has the same shape:

| Section | What you do |
|---|---|
| **Goal** | Read. What we're building and why. |
| **Concepts** | Read carefully. The TypeScript ideas this lesson teaches. |
| **Tests first** | Type the tests. Run `npm test`. See them fail (red). |
| **The code** | Type the code. Run `npm run check`. See everything pass (green). |
| **What you should see** | Compare your output. |
| **Study Drills** | Do them. No code is given. |
| **Checkpoint** | Tell Claude "lesson NN done" → code review + quiz → tick it off in `PROGRESS.md`. |

## Commands

```sh
npm test            # run all tests
npm run typecheck   # run the TypeScript compiler (type errors only, no output files)
npm run check       # both — this is the one that counts
npm run wyrm        # start the REPL (from lesson 22; in lesson 21 use `node src/main.ts`)
npm run wyrm -- examples/fib.wyrm   # run a file (from lesson 22)
```

> ⚠️ Node runs `.ts` files by *stripping* the types — it never checks them.
> A program with type errors will still run. **`npm run typecheck` is the only thing
> that tells you the truth.** Always use `npm run check`.

## Files

- `PROGRESS.md` — your checklist.
- `CONTEXT.md` — the glossary. When a lesson uses a word like *lexeme* or *environment*, it
  means exactly what's written there.
- `docs/adr/` — records of design decisions and why they were made.
- `lessons/` — the course.

## Course map

| # | Lesson | Main TypeScript idea |
|---|---|---|
| 01 | [Setup](lessons/01-setup.md) | tsconfig, ES modules, `node:test`, type stripping |
| 02 | [Tokens](lessons/02-tokens.md) | literal unions, `as const`, type predicates |
| 03 | [Scanner I](lessons/03-scanner-basics.md) | classes, `private`/`readonly`, generic `Result<T, E>` |
| 04 | [Scanner II](lessons/04-scanner-literals.md) | helper functions, default parameters |
| 05 | [The AST](lessons/05-ast.md) | discriminated unions, recursive types |
| 06 | [AST printer](lessons/06-printer.md) | exhaustive `switch`, `never`, rest parameters |
| 07 | [Parser I](lessons/07-parser-arithmetic.md) | recursive descent, precedence |
| 08 | [Parser II](lessons/08-parser-errors.md) | custom `Error` classes, `override`, `instanceof` |
| 09 | [Pipeline & first CLI](lessons/09-pipeline-cli.md) | `process.argv`, exit codes, `exactOptionalPropertyTypes` |
| 10 | [Evaluating expressions](lessons/10-evaluator.md) | `typeof` narrowing, union return types |
| 11 | [Runtime errors](lessons/11-runtime-errors.md) | assertion functions (`asserts x is T`) |
| 12 | [Statements & print](lessons/12-statements.md) | function types, dependency injection |
| 13 | [Variables](lessons/13-variables.md) | `Map<K, V>`, the compiler as a refactoring guide |
| 14 | [Blocks & scope](lessons/14-scope.md) | recursive classes, `try`/`finally` |
| 15 | [if / and / or](lessons/15-if-logic.md) | adding union members, case fallthrough |
| 16 | [while](lessons/16-while.md) | consolidation |
| 17 | [Functions](lessons/17-functions.md) | getters, circular `import type` |
| 18 | [return](lessons/18-return.md) | modelling control flow as data |
| 19 | [Closures](lessons/19-closures.md) | object identity & lifetime |
| 20 | [Native functions](lessons/20-natives.md) | generics, mapped tuple types, `const` type params |
| 21 | [The REPL](lessons/21-repl.md) | `async`/`await`, streams, `for await` |
| 22 | [Running files](lessons/22-file-runner.md) | `node:fs/promises`, `unknown` errors, top-level await |
| 23 | [Resolver (capstone)](lessons/23-resolver.md) | static analysis, `Map` keyed by objects |
