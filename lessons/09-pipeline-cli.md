# Lesson 09 — Pipeline and first CLI

## Goal

Connect the scanner, the parser and the printer into a program you can run from the terminal:

```sh
node src/ast-cli.ts "1 + 2 * 3"
(+ 1 (* 2 3))
```

Bad input prints readable diagnostics on stderr and exits with code 65. You'll also write
`formatDiagnostic`, which turns a `Diagnostic` into a line like
`[1:4] Error at end: Expect expression.`, and you'll test the CLI by actually running it.

## Concepts

### Reading an optional property

Lesson 08 made `at` optional. With `exactOptionalPropertyTypes` you can't *write*
`at: undefined`, but reading an absent property still gives `undefined`, so the type of `d.at`
is `string | undefined`. Narrow it like any other union:

```ts
function describe(o: { label?: string }): string {
  return o.label === undefined ? "(none)" : `label ${o.label}`;
}
```

After `=== undefined` is ruled out, `o.label` is a `string` in the other branch. That's the
whole trick in `formatDiagnostic`.

### `process.argv`

A Node program gets its command-line arguments in `process.argv`, an array of strings:

```text
node src/ast-cli.ts 1 + 2
argv[0] = "/usr/bin/node"          (the node binary)
argv[1] = "/…/wyrm/src/ast-cli.ts" (the script)
argv[2] = "1"
argv[3] = "+"
argv[4] = "2"
```

`process.argv.slice(2)` drops the first two. `slice` returns a `string[]`, not
`(string | undefined)[]`. `noUncheckedIndexedAccess` only affects *indexing*, not methods that
return arrays.

The shell splits arguments on spaces and expands some characters. `*` is a filename wildcard,
so `node src/ast-cli.ts 1 * 2` would pass the names of every file in the folder. Put the
expression in quotes and it arrives as a single argument.

### stdout, stderr and exit codes

A command-line program has two output streams and one number:

- `console.log` writes to **stdout**, for the real output.
- `console.error` writes to **stderr**, for problems. Keeping them apart means
  `node src/ast-cli.ts "1+2" > out.txt` puts only the tree in the file.
- The **exit code** tells the shell whether it worked. `0` means success. We use `65` for bad
  input. That's `EX_DATAERR` from the Unix `sysexits.h` convention, and it's what the classic
  interpreter books use too.

`process.exit(code)` stops the program right away with that code.

### `never` from `process.exit`

In `@types/node`, `process.exit` is declared as returning `never`: it never returns, because
the program is gone. TypeScript uses that for narrowing, exactly like `assert.fail` in the
tests:

```ts
const r: Result<number, string> = compute();
if (!r.ok) {
  console.error(r.error);
  process.exit(1);   // returns never: nothing after this line in the block runs
}
r.value;             // fine: here r must be the ok case
```

Delete the `process.exit` line and the `if` block can fall through, so after it `r` could
still be the error case, and `r.value` becomes a type error. The CLI relies on this twice.

### Testing a CLI with `spawnSync`

The honest way to test a program is to run it. `node:child_process` has `spawnSync`, which
starts a process, waits for it to finish, and hands back what happened:

```ts
import { spawnSync } from "node:child_process";
const r = spawnSync("node", ["--version"], { encoding: "utf8" });
r.status; // number | null: the exit code (null if killed by a signal)
r.stdout; // string
r.stderr; // string
```

`{ encoding: "utf8" }` matters for the types. `spawnSync` has several overloads. Without an
encoding, `stdout` is a `Buffer` (raw bytes). With one, TypeScript picks the overload whose
`stdout` is a `string`.

The path `src/ast-cli.ts` is relative to the *current directory*. `npm test` runs from the
project root, so it works there.

## Tests first

Two new test files.

### `test/format.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDiagnostic } from "../src/format.ts";

test("diagnostic with a location", () => {
  assert.equal(
    formatDiagnostic({ line: 1, col: 4, message: "Expect expression.", at: "end" }),
    "[1:4] Error at end: Expect expression.",
  );
});

test("diagnostic without a location", () => {
  assert.equal(
    formatDiagnostic({ line: 2, col: 1, message: "Unexpected character '@'." }),
    "[2:1] Error: Unexpected character '@'.",
  );
});
```

The second test has no `at`. It's shaped like a scanner diagnostic.

### `test/ast-cli.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runCli(...args: string[]) {
  return spawnSync("node", ["src/ast-cli.ts", ...args], { encoding: "utf8" });
}

test("prints the AST of a valid expression", () => {
  const result = runCli("1 + 2 * 3");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "(+ 1 (* 2 3))\n");
});

test("reports errors and exits with 65", () => {
  const result = runCli("(1 +");
  assert.equal(result.status, 65);
  assert.equal(result.stderr, "[1:5] Error at end: Expect expression.\n");
});
```

`runCli` has no return type annotation. TypeScript infers it from `spawnSync`'s overload, so
`result.stdout` is a `string` in the tests. Note the exact strings: `console.log` and
`console.error` each add a `"\n"`.

In `(1 +`, the `eof` token is at column 5, so the parser reports `Expect expression.` there,
before it gets a chance to complain about the missing `)`.

Run both:

```sh
npm test
npm run typecheck
```

`npm test` shows three failures. `test/format.test.ts` fails to load:
`Cannot find module '…/src/format.ts'`. The two CLI tests *do* run, but `node` can't find
`src/ast-cli.ts` and exits with code 1, so you see `actual: 1, expected: 0` and
`actual: 1, expected: 65`. `npm run typecheck` reports only `format.ts` (TS2307). The CLI test
refers to `src/ast-cli.ts` inside a string, and `tsc` doesn't look inside strings.

## The code

### `src/format.ts`

```ts
import type { Diagnostic } from "./diagnostic.ts";

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.at === undefined ? "" : ` at ${d.at}`;
  return `[${d.line}:${d.col}] Error${where}: ${d.message}`;
}
```

`where` is either empty or `" at end"`. Look at the output format: `[line:col]` first, so every
error message starts in the same place, then `Error`, then the location if there is one.

Run `npm test`. The two format tests pass; the CLI tests still fail.

### `src/ast-cli.ts`

```ts
import { formatDiagnostic } from "./format.ts";
import { parseExpression } from "./parser.ts";
import { printExpr } from "./printer.ts";
import { scan } from "./scanner.ts";

const source = process.argv.slice(2).join(" ");

const scanned = scan(source);
if (!scanned.ok) {
  for (const d of scanned.error) console.error(formatDiagnostic(d));
  process.exit(65);
}

const parsed = parseExpression(scanned.value);
if (!parsed.ok) {
  for (const d of parsed.error) console.error(formatDiagnostic(d));
  process.exit(65);
}

console.log(printExpr(parsed.value));
```

This file has no functions and no exports. It's a script: its top level *is* the program.

- `join(" ")` glues the arguments back together, so both `"1 + 2"` and unquoted `1 + 2` work.
  With no arguments, `source` is `""`, and the parser reports `Expect expression.` at `end`.
- After the first `if`, `scanned` is narrowed to the ok case, because the only way out of the
  block is `process.exit`, which returns `never`. That's why `scan` and `parseExpression`
  can be called one after the other with no nesting.
- A scanner can report several diagnostics at once (lesson 03), so both blocks loop.

Now run it yourself:

```sh
node src/ast-cli.ts "1 + 2 * 3"
node src/ast-cli.ts "(1 + 2) * 3"
node src/ast-cli.ts "(1 +"
echo $?
node src/ast-cli.ts "1 @ 2 # 3"
```

`echo $?` prints the exit code of the previous command: `65`. The last command prints two
scanner diagnostics, with no `at` part:

```
[1:3] Error: Unexpected character '@'.
[1:7] Error: Unexpected character '#'.
```

Then:

```sh
npm run check
```

## What you should see

`tsc` prints nothing. Then:

```
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

The CLI tests take noticeably longer than the others (tens of milliseconds each). Each one
starts a whole new Node process.

Commit:

```sh
git add -A
git commit -m "Add diagnostic formatting and AST CLI"
```

## Study Drills

1. Delete the first `process.exit(65);` in `ast-cli.ts` and run `npm run typecheck`. Read the
   error about `value`. Explain why removing a line in one place causes an error on a
   *different* line. Undo it.
2. Run `node src/ast-cli.ts 1 * 2` without quotes. Then run `echo 1 * 2`. Explain what the
   shell did. Try `node src/ast-cli.ts "1 * 2" > out.txt`, then `node src/ast-cli.ts "1 +"
   > out.txt`. Where did the output go each time? Delete `out.txt`.
3. In `ast-cli.test.ts`, remove `{ encoding: "utf8" }`. Hover over `result.stdout` in your
   editor to see its type, then run `npm run typecheck` and `npm test`. The type checker is
   happy but the tests fail. Why doesn't `tsc` catch it? (Look at the parameter types of
   `assert.equal`.) Why does the test fail even though the bytes are the same? Undo it.
4. Change `formatDiagnostic` to use `d.at ? … : …` (truthiness) instead of
   `d.at === undefined`. The tests still pass. What `at` value would behave differently, and
   can the parser ever produce it? Undo it.
5. Optional extension: in a scratch copy (not in `src/`), write a script that prints
   `process.argv` and run it with a few arguments, including quoted ones with spaces.
6. Explain in your own words why the CLI writes diagnostics to stderr and uses a non-zero exit
   code, rather than printing everything with `console.log`.

## Checkpoint

Tell Claude: **"lesson 09 done"**. Expect questions like: *What's in `process.argv[0]` and
`[1]`? How does `process.exit` let TypeScript narrow `scanned`? Why does the test pass
`{ encoding: "utf8" }`? What does exit code 65 mean?*
