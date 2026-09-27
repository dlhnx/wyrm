# Lesson 01 — Setup

## Goal

Get a TypeScript project running with **no build step**: Node runs `.ts` directly, `tsc` checks
types, and `node:test` runs tests. By the end, `npm run check` prints a green test.

You already know `tsc`, `tsx`, and `tsconfig.json` from ace-dragon. This setup is stricter, and
it uses a newer way of running TypeScript. Read [ADR 0001](../docs/adr/0001-native-type-stripping.md) first.

## Concepts

### Type stripping vs. type checking

Node 24 can run `node file.ts`. It **strips** the types (deletes `: string`, `interface …`, etc.)
and runs the JavaScript that's left. It never checks whether the types are right.

```
             ┌───────────────┐
 greet.ts ──►│ node (strip)  │──► runs, even if types are wrong
             └───────────────┘
             ┌───────────────┐
 greet.ts ──►│ tsc --noEmit  │──► type errors, or nothing (= good). Produces no files.
             └───────────────┘
```

So there are two separate questions: *does it run?* (node) and *is it correct?* (tsc).
`npm run check` asks both.

### ES modules

`"type": "module"` in `package.json` means we use `import`/`export` (ES modules), not
`require`. Imports include the real file extension, `.ts`, because Node doesn't guess
extensions, and at runtime the file really is `greet.ts`.

### `node:test`

Node has a test runner built in. `test("name", () => { … })` registers a test.
`assert` from `node:assert/strict` throws if something's wrong. A test that throws fails.

## Step 1 — Create the project

The `wyrm/` folder and its git repo already exist (the course files are in it). In a terminal
inside `wyrm/`:

```sh
npm init -y
npm install --save-dev typescript @types/node@^24
```

- `typescript` gives you `tsc`, the type checker.
- `@types/node` provides type declarations for Node's built-in modules (`node:test`,
  `node:fs`, `process`, …). Without it, TypeScript doesn't know those exist.

Create `.gitignore`:

```gitignore
node_modules
```

## Step 2 — `package.json`

Open `package.json` and make it look like this. Keep whatever version numbers `npm install`
wrote under `devDependencies`.

```json
{
  "name": "wyrm",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"test/**/*.test.ts\"",
    "typecheck": "tsc",
    "check": "npm run typecheck && npm test"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^7.0.2"
  }
}
```

The test glob means "every file ending in `.test.ts` under `test/`". Helper files in `test/`
that don't end in `.test.ts` won't run as tests.

## Step 3 — `tsconfig.json`

Type this one slowly and read each comment. You don't need to type the comments; the file
works the same without them.

```jsonc
{
  "compilerOptions": {
    // --- What world are we in? ---
    "target": "esnext",            // we may use the newest JavaScript syntax
    "module": "nodenext",          // module rules exactly like Node's
    "types": ["node"],             // load @types/node

    // --- No build step (see ADR 0001) ---
    "noEmit": true,                     // tsc only checks; it writes no .js files
    "allowImportingTsExtensions": true, // allow `import … from "./x.ts"`
    "erasableSyntaxOnly": true,         // forbid syntax Node can't strip (enum, namespace, …)
    "verbatimModuleSyntax": true,       // type-only imports must say `import type`

    // --- As strict as it gets ---
    "strict": true,                        // the big one: null checks, no implicit any, …
    "noUncheckedIndexedAccess": true,      // arr[i] is `T | undefined` (you know this one)
    "exactOptionalPropertyTypes": true,    // `x?: string` does NOT accept `x: undefined`
    "noImplicitOverride": true,            // overriding a parent member needs `override`
    "noImplicitReturns": true,             // every path of a function must return
    "noFallthroughCasesInSwitch": true,    // a non-empty `case` must end in return/break
    "noUnusedLocals": true,                // unused variables are errors
    "noUnusedParameters": true,            // unused parameters are errors (prefix with _ to allow)
    "noPropertyAccessFromIndexSignature": true, // obj.foo only for declared properties
    "skipLibCheck": true                   // don't type-check node_modules' .d.ts files
  },
  "include": ["src", "test"]
}
```

## Step 4 — Tests first

Create `test/greet.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { greet } from "../src/greet.ts";

test("greet says hello", () => {
  assert.equal(greet("wyrm"), "Hello, wyrm!");
});
```

Run it:

```sh
npm test
```

It fails because `../src/greet.ts` doesn't exist. **Read the whole error.** You should see a
"Cannot find module" error. That's red. Now make it green.

## Step 5 — The code

Create `src/greet.ts`:

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

Run:

```sh
npm run check
```

## What you should see

`tsc` prints nothing (that means no type errors), then:

```
✔ greet says hello (0.6ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Set up TypeScript project"
```

## Study Drills

1. Inside the test, add a line `console.log(greet(42));`. Run `npm test`, then
   `npm run typecheck`. One of them complains and one doesn't. Explain why in one
   sentence. Then remove the line.
2. Add `enum Color { Red }` to `greet.ts` and run `npm run typecheck`. Which option rejects
   it? Look at [ADR 0001](../docs/adr/0001-native-type-stripping.md) for why. Remove it.
3. Add `let unused = 1;` inside `greet`. Which option catches it? Remove it.
4. Write a second test, `greet("")`. What *should* it return? Decide, write the test, and
   make it pass without breaking the first test.
5. Find the Node docs page for `node:test` and look up `test.skip` and `test.only`. Try
   each one.

## Checkpoint

Tell Claude: **"lesson 01 done"**. Expect questions like: *What's the difference between
running and type-checking? Why does the import say `.ts`? What does
`exactOptionalPropertyTypes` change?*
