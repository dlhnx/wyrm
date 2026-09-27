# Lesson 22 — Running files

## Goal

Make `wyrm` a real command-line tool:

```sh
npm run wyrm                        # no argument: the REPL
npm run wyrm -- examples/fib.wyrm   # one argument: run that file
```

When a file has an error, show the offending line with a caret under the exact column, and
exit with a code that tells a script *what kind* of failure happened:

```
[2:7] Runtime error: Operand must be a number.
  2 | print -"x";
    |       ^
```

## Concepts

### Reading a file: `node:fs/promises`

`node:fs` has three styles of API: callbacks, synchronous (`readFileSync`), and promises. In
an `async` function, the promise style reads naturally:

```ts
import { readFile } from "node:fs/promises";

const text = await readFile("notes.txt", "utf8");
```

Passing the encoding `"utf8"` matters for the types, too. With it, `readFile` returns
`Promise<string>`. Without it, you get a `Buffer` (raw bytes). The overloads in `@types/node`
pick the return type from the arguments you pass.

If the file doesn't exist, the promise **rejects**, and `await` turns that into a thrown
error you can `catch`.

### Caught errors are `unknown`

JavaScript lets you `throw` anything: an `Error`, a string, `42`, `undefined`. So under
`strict`, the variable in `catch (error)` has type `unknown`, not `Error`. You have to narrow it
before you use it:

```ts
try {
  risky();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(reason);
}
```

`instanceof Error` narrows `error` to `Error` in the true branch, so `.message` is allowed.
In the false branch we don't know what it is, so `String(error)` turns it into *something*
printable. You've seen `instanceof` narrowing since lesson 08. The new part is that the
starting type is `unknown`.

### Definite assignment

You can declare a `let` with a type and no value, and assign it later:

```ts
let port: number;
if (process.env["PORT"] === undefined) {
  port = 8080;
} else {
  port = Number(process.env["PORT"]);
}
console.log(port); // fine: every path assigned it
```

TypeScript follows each path through the code. If there's any path where you read the
variable before assigning it, you get *"Variable 'port' is used before being assigned."* A
path that ends in `return` or `throw` doesn't count, because it never reaches the read.

In `runFile` the pattern is: assign `source` inside `try`, `return` from `catch`. After the
`try`/`catch`, the only way to get there is through a successful read, so `source` is
definitely a `string`.

### Destructuring with a rest element

```ts
const [first, ...others] = ["a", "b", "c"];
// first: "a", others: ["b", "c"]
```

The rest element `...others` collects everything after `first` into a new array (possibly
empty). What's the type of `first`? The array might be empty, and with
`noUncheckedIndexedAccess` TypeScript is honest about that: `first` is `string | undefined`.
`others` is `string[]`, because an empty array is still an array.

wyrm's `main` does `const [path, ...rest] = args;`. `path` is `string | undefined` (no
argument means REPL), and `rest.length > 0` means the user passed too many arguments.

### Exit codes: `process.exitCode` vs. `process.exit()`

A program's exit code is how it tells the shell, CI, or `make` whether it worked. `0` means
success, and anything else means failure. Node has two ways to set it:

- `process.exit(65)` stops the process **right now**. Anything still queued, like output being
  written to a pipe, may be cut off.
- `process.exitCode = 65` just records the code. The process ends naturally when it has
  nothing left to do, and then it uses that code.

The `ast-cli.ts` from lesson 09 uses `process.exit`. The new `main.ts` sets
`process.exitCode` once, at the very end. It's the safer habit.

Which numbers? There's an old convention from BSD, `sysexits.h`:

| Code | Name | Meaning in wyrm |
|---|---|---|
| 0 | OK | the program ran |
| 64 | `EX_USAGE` | wrong command-line arguments |
| 65 | `EX_DATAERR` | the program has a syntax error |
| 66 | `EX_NOINPUT` | the file can't be read |
| 70 | `EX_SOFTWARE` | the program failed at runtime |

### `as const` on an object

```ts
const LIMITS = { min: 1, max: 10 };           // { min: number; max: number }
const FIXED = { min: 1, max: 10 } as const;   // { readonly min: 1; readonly max: 10 }
```

Without `as const`, the object is mutable and its properties are plain `number`. Someone
could write `LIMITS.max = 11` and nothing would stop them. With `as const`, every property is
`readonly` and has its exact literal type. It's the object version of what you did with token
types in lesson 02. For a table of constants, it's what you want, and it's a replacement for
`enum`, which `erasableSyntaxOnly` forbids (ADR 0001).

### `flatMap`

`map` turns each item into one item. `flatMap` turns each item into an **array** of items and
joins all the arrays together:

```ts
["a", "b"].map((s) => [s, s.toUpperCase()]);     // [["a","A"], ["b","B"]]
["a", "b"].flatMap((s) => [s, s.toUpperCase()]); // ["a", "A", "b", "B"]
```

Each diagnostic becomes three lines (the message plus two excerpt lines), and you want one
flat list of lines. That's `flatMap`.

## Tests first

These tests don't import anything from `src/`. They **spawn the real CLI** as a child
process, the way a user would run it, and check its stdout, stderr and exit code. That's an
*end-to-end* test.

First, the two example programs the tests run. Create the folder `examples/`.

### `examples/fib.wyrm`

```
// The classic.
fn fib(n) {
  if (n < 2) { return n; }
  return fib(n - 1) + fib(n - 2);
}

let i = 0;
while (i < 10) {
  print "fib(" + str(i) + ") = " + str(fib(i));
  i = i + 1;
}
```

### `examples/counter.wyrm`

```
fn makeCounter() {
  let count = 0;
  fn inc() {
    count = count + 1;
    return count;
  }
  return inc;
}

let a = makeCounter();
let b = makeCounter();
a();
a();
print a(); // 3
print b(); // 1
```

### `test/main.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function wyrm(args: string[], input = "") {
  return spawnSync("node", ["src/main.ts", ...args], { encoding: "utf8", input });
}

function script(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "wyrm-"));
  const path = join(dir, "script.wyrm");
  writeFileSync(path, source);
  return path;
}

test("runs a file", () => {
  const result = wyrm([script('print "hi";')]);
  assert.equal(result.stdout, "hi\n");
  assert.equal(result.status, 0);
});

test("runs the examples", () => {
  assert.equal(wyrm(["examples/counter.wyrm"]).stdout, "3\n1\n");
  assert.match(wyrm(["examples/fib.wyrm"]).stdout, /fib\(9\) = 34/);
});

test("syntax errors exit with 65 and show the line", () => {
  const result = wyrm([script("let x = 1;\nprint (x;\n")]);
  assert.equal(result.status, 65);
  assert.equal(
    result.stderr,
    "[2:9] Error at ';': Expect ')' after expression.\n" +
      "  2 | print (x;\n" +
      "    |         ^\n",
  );
});

test("runtime errors exit with 70", () => {
  const result = wyrm([script('print 1;\nprint -"x";\n')]);
  assert.equal(result.status, 70);
  assert.equal(result.stdout, "1\n");
  assert.match(result.stderr, /^\[2:7\] Runtime error: Operand must be a number\./);
});

test("missing file exits with 66", () => {
  const result = wyrm(["does-not-exist.wyrm"]);
  assert.equal(result.status, 66);
  assert.match(result.stderr, /^Could not read does-not-exist\.wyrm/);
});

test("too many arguments exits with 64", () => {
  assert.equal(wyrm(["a", "b"]).status, 64);
});

test("no arguments starts the REPL", () => {
  assert.equal(wyrm([], "1 + 1\n").stdout, "> 2\n> ");
});
```

Notes:

- `spawnSync` runs `node src/main.ts …` and waits for it to finish. `encoding: "utf8"` makes
  `stdout` and `stderr` strings instead of `Buffer`s, and `input` is written to the child's
  stdin. The relative path `src/main.ts` works because `npm test` runs from the project root.
- `wyrm` has no return type annotation. TypeScript infers `SpawnSyncReturns<string>` from the
  `encoding` overload. `input = ""` is a default parameter (lesson 04), so its type is
  inferred as `string`.
- `script` writes the source to a fresh temporary directory. `mkdtempSync` adds random
  characters after the `wyrm-` prefix, so tests never step on each other's files, and nothing
  gets written into your project.
- `result.status` is the exit code.
- The runtime error test checks stdout *and* stderr: `print 1;` still printed before the
  error, just as the glossary says a runtime error should behave.

Run both:

```sh
npm test
npm run typecheck
```

This time `tsc` is **happy**. The test file imports nothing from `src/`, so there's no
missing export for it to complain about. `npm test` fails 6 of the 7 new tests: `tests 102`,
`pass 96`, `fail 6`. Look at why: your current `main.ts` ignores its arguments and always
starts the REPL. Stdin is empty, so it prints `> ` and exits with 0. That's why "runs a file"
reports `'> '` where it expected `'hi\n'`. The one new test that passes is "no arguments
starts the REPL". It's already true.

## The code

### `src/format.ts`: the excerpt

Add this function at the end of the file, after `formatRuntimeError`:

```ts

/** The offending source line with a caret under the column, e.g.
 *
 *     2 | print -"x";
 *       |       ^
 */
export function excerpt(source: string, line: number, col: number): string[] {
  const text = source.split("\n")[line - 1];
  if (text === undefined) return [];
  const gutter = String(line);
  const pad = " ".repeat(gutter.length);
  return [`  ${gutter} | ${text}`, `  ${pad} | ${" ".repeat(col - 1)}^`];
}
```

- Lines and columns start at 1 (see the glossary), and arrays start at 0, hence `line - 1`
  and `col - 1`.
- Indexing an array gives `string | undefined` under `noUncheckedIndexedAccess`. A
  diagnostic *should* always point at a real line, but the compiler can't know that, and
  neither can a future caller who passes the wrong source. Returning `[]` means "no
  excerpt", and the caller doesn't need to care.
- `gutter` is the line number as text, and `pad` is that many spaces, so the `|` lines up on
  both rows even for line 100.

### `src/wyrm.ts`: formatting, exit codes

Change the `format.ts` import to also bring in `excerpt`:

```ts
import { excerpt, formatDiagnostic, formatRuntimeError } from "./format.ts";
```

Then add this block right after `formatOutcome` and before `guard`:

```ts
/** Like formatOutcome, but shows the offending source line under each error. */
export function formatOutcomeWithSource(outcome: Outcome, source: string): string[] {
  switch (outcome.kind) {
    case "ok":
      return [];
    case "syntax-error":
      return outcome.diagnostics.flatMap((d) => [
        formatDiagnostic(d),
        ...excerpt(source, d.line, d.col),
      ]);
    case "runtime-error": {
      const { token } = outcome.error;
      return [formatRuntimeError(outcome.error), ...excerpt(source, token.line, token.col)];
    }
  }
}

/** Conventional exit codes (from BSD sysexits.h). */
export const EXIT = {
  ok: 0,
  usage: 64,
  dataErr: 65,
  noInput: 66,
  software: 70,
} as const;

export function exitCode(outcome: Outcome): number {
  switch (outcome.kind) {
    case "ok": return EXIT.ok;
    case "syntax-error": return EXIT.dataErr;
    case "runtime-error": return EXIT.software;
  }
}
```

- `formatOutcomeWithSource` is `formatOutcome` plus excerpts. The REPL keeps using the plain
  one, since the line you just typed is right there on screen.
- `...excerpt(…)` spreads the (zero or two) excerpt lines into the array after the message.
- The `"runtime-error"` case has braces `{ … }` because it declares a `const`. Without them,
  `token` would be scoped to the whole `switch` body, visible to the other cases too. The
  braces keep it local to this case.
- `const { token } = outcome.error;` destructures one property. After the `case`,
  `outcome` has been narrowed, so TypeScript knows `outcome.error` exists and is a
  `RuntimeError`.
- `exitCode` returns `number`, not the literal union. The caller only needs a number to give
  to `process.exitCode`.

### `src/main.ts`

Most of the file changes. Replace the whole file with:

```ts
import { readFile } from "node:fs/promises";
import { Interpreter } from "./interpreter.ts";
import { repl } from "./repl.ts";
import { EXIT, exitCode, formatOutcomeWithSource, runSource } from "./wyrm.ts";

async function runFile(path: string): Promise<number> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Could not read ${path}: ${reason}`);
    return EXIT.noInput;
  }
  const outcome = runSource(new Interpreter(), source);
  for (const line of formatOutcomeWithSource(outcome, source)) console.error(line);
  return exitCode(outcome);
}

async function main(args: readonly string[]): Promise<number> {
  const [path, ...rest] = args;
  if (rest.length > 0) {
    console.error("Usage: wyrm [script.wyrm]");
    return EXIT.usage;
  }
  if (path === undefined) {
    await repl(process.stdin, process.stdout);
    return EXIT.ok;
  }
  return runFile(path);
}

process.exitCode = await main(process.argv.slice(2));
```

- **`runFile`**: `let source: string;` has no value yet. The `try` assigns it, and the `catch`
  returns, so by the time `runSource` runs, `source` is definitely assigned (see Concepts).
  Only the *read* is inside the `try`. If running the program were inside it too, a bug in
  the interpreter would be reported as "Could not read …", which would be a lie.
- `new Interpreter()` with no argument uses the default output, `console.log` (lesson 12).
  Program output goes to **stdout** and errors go to **stderr**, so
  `wyrm prog.wyrm > out.txt` captures only the program's output.
- **`main`** returns the exit code instead of setting it. That keeps it a plain function of its
  arguments. Only the last line touches `process`.
- `process.argv` is `["/path/to/node", "/path/to/src/main.ts", ...userArgs]`, so
  `.slice(2)` is what the user typed.
- The `path === undefined` check comes *before* `runFile(path)`. After it, TypeScript has
  narrowed `path` to `string`, which is what `runFile` requires.
- `return runFile(path);` returns a promise from an `async` function. That's fine: `async`
  functions flatten it, so `main` still returns `Promise<number>`, not
  `Promise<Promise<number>>`.

### `package.json`

Add one line to `"scripts"`. Find:

```json
  "scripts": {
    "test": "node --test \"test/**/*.test.ts\"",
```

Change it to:

```json
  "scripts": {
    "wyrm": "node src/main.ts",
    "test": "node --test \"test/**/*.test.ts\"",
```

With npm, arguments for the script go after `--`: `npm run wyrm -- examples/fib.wyrm`.
Without the `--`, npm would try to read the arguments itself.

### Try it

```sh
npm run wyrm -- examples/fib.wyrm
npm run wyrm -- examples/counter.wyrm
npm run wyrm -- nope.wyrm; echo "exit $?"
npm run wyrm
```

The last one is the REPL, and Ctrl-D quits. Then make a broken file *outside* the project, for
example `/tmp/bad.wyrm` containing `print 1;`, then `print -"x";` on the next line, and run
it:

```
1
[2:7] Runtime error: Operand must be a number.
  2 | print -"x";
    |       ^
```

`echo $?` afterwards prints `70`.

## What you should see

`npm run check`: `tsc` prints nothing, then:

```
ℹ tests 102
ℹ pass 102
ℹ fail 0
```

These tests spawn processes, so this test file is noticeably slower than the others. That's
normal.

Commit:

```sh
git add -A
git commit -m "Run wyrm files from the command line"
```

## Study Drills

1. **Break it on purpose.** In `runFile`, comment out the `return` inside the `catch`. Run
   `npm run typecheck` and read the error, and count how many times it appears and on which
   lines. Then run `npm run wyrm -- nope.wyrm` anyway: what does Node do with code that
   `tsc` rejected? Undo it.
2. Delete the `"runtime-error"` case from `exitCode`. Read the error code and message, and
   explain why TypeScript can't just return `undefined` there. Put it back, then remove `as const` from `EXIT`. Does anything break? Add a
   temporary line that assigns a new number to `EXIT.usage` and type-check with and without
   `as const`. Undo everything.
3. **Explain in your own words** why `main.ts` sets `process.exitCode` instead of calling
   `process.exit()`. Then explain why `path` is `string | undefined` even though `args` is
   `readonly string[]`, and which tsconfig option causes it.
4. **Small extension.** Add a test that an empty file runs with exit code 0 and prints
   nothing to stdout or stderr. Predict first: does it need any code change? Run it, then
   delete it so your test count matches the next lesson.
5. Make a file with *two* syntax errors on different lines and run it. How many excerpts do
   you get? Find the line in `formatOutcomeWithSource` that produces them. What would the
   output look like if it used `map` instead of `flatMap`? Answer before you check with the
   compiler.
6. Put a tab at the start of the broken line in your `/tmp` file and run it again. Where does
   the caret land? Explain why, in one sentence. (No fix needed. Real tools handle this, and
   it's a nice problem to keep for later.)

## Checkpoint

Tell Claude: **"lesson 22 done"**. Expect questions like: *Why is the `catch` variable
`unknown` and not `Error`? How does TypeScript know `source` is assigned after the
`try`/`catch`? What's the difference between `process.exit(65)` and
`process.exitCode = 65`? What does `as const` change about `EXIT`'s type?*
