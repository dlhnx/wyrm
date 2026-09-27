# Lesson 21 — The REPL

## Goal

Give wyrm an interactive prompt. You type a line, wyrm runs it, and the variables stay alive
for the next line. A bare expression like `1 + 2` (no `;`) is echoed back:

```
> let x = 20;
> x * 2
40
> print -nil;
[1:7] Runtime error: Operand must be a number.
>
```

Along the way you'll pull the "scan, parse, run, report" pipeline out of the test helpers into
one real module, `src/wyrm.ts`, which the REPL, the tests, and (next lesson) the file runner
all share.

## Concepts

### `async` functions and `Promise<void>`

Reading from a keyboard is slow. The program can't just stop and wait for a line, so Node
hands you the lines *later*, when they arrive. An `async` function lets you write that waiting
as if it were ordinary top-to-bottom code:

```ts
async function slowHello(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log("hello");
}
```

- `async` makes the function return a **`Promise`**, a value that means "this finishes later".
- `await` pauses *this function* (not the whole program) until a promise settles.
- The return type is `Promise<T>`, where `T` is what you `return`. A function that returns
  nothing is `Promise<void>`. TypeScript won't let you write `: void` on an `async` function,
  because it always returns a promise.

Whoever calls `slowHello()` gets the promise right away. They `await` it if they want to know
when it's done. Our tests will do exactly that: start a REPL session and `await` it until the
input runs out.

### Streams: `Readable` and `Writable`

A **stream** is data that arrives (or leaves) in chunks over time. `process.stdin` is a
`Readable` (you read from it), and `process.stdout` is a `Writable` (you write to it). They
aren't the only ones. Files, sockets, and in-memory pipes are streams too.

```ts
import { PassThrough } from "node:stream";

const pipe = new PassThrough(); // both Readable and Writable
pipe.on("data", (chunk: Buffer) => console.log("got", chunk.toString()));
pipe.write("hi"); // got hi
```

A `PassThrough` is a pipe: whatever you write in comes out the other end. It's perfect for
tests. `PassThrough.from(["a\n", "b\n"])` makes a readable stream that produces those chunks
and then ends, which is what a user does when they type two lines and press Ctrl-D.

The types come from `node:stream`, and since we only use them in annotations, we import them
with `import type`, as `verbatimModuleSyntax` requires.

### `for await … of`

Node's `node:readline` turns a stream of raw chunks into a stream of *lines*. The object it
gives you is an **async iterable**: like an array you can loop over, except each item may not
exist yet. `for await` waits for each one:

```ts
for await (const line of lines) {
  console.log(`you typed: ${line}`);
}
console.log("input ended");
```

The loop body runs once per line. When the input ends (Ctrl-D in a terminal, or the end of a
`PassThrough`), the loop finishes and the code after it runs. `for await` is only allowed
inside an `async` function (or at the top level of a module, see below).

### Top-level `await`

In an ES module (`"type": "module"`, lesson 01) you can use `await` outside any function, at
the top level of the file:

```ts
const config = await loadConfig();
console.log(config.name);
```

Node waits for the promise before it considers the module finished. Our entry point,
`src/main.ts`, will be a single line: `await` the REPL.

### Design point: pass the streams in

The easy way to write a REPL is to reach straight for `process.stdin` and `process.stdout`
inside it. That works, but then the only way to test it is to spawn a real process and type
into it.

Instead, `repl` takes its input and output as **parameters**:

```ts
async function repl(input: Readable, output: Writable): Promise<void>
```

The real program passes `process.stdin` and `process.stdout`. The tests pass two
`PassThrough`s, feed in some lines, and compare the text that comes out. It's the same trick as
the interpreter's `Output` function from lesson 12 (dependency injection): the part that
touches the outside world is plugged in, so the logic can be tested without it.

### One front door: the `Outcome` union

So far, `test/helpers.ts` has been the only place that ran the whole pipeline (scan, parse,
interpret, catch runtime errors). Now the REPL needs the same thing, so it moves into
`src/wyrm.ts`, and its result gets a proper type, a discriminated union (lesson 05). In
simplified form (the real one adds `readonly` everywhere):

```ts
type Outcome =
  | { kind: "ok" }
  | { kind: "syntax-error"; diagnostics: Diagnostic[] }
  | { kind: "runtime-error"; error: RuntimeError };
```

Running a program either works, fails before it starts (diagnostics), or fails partway through
(one runtime error). The caller `switch`es on `kind` and decides what to show. The REPL prints
the errors and keeps going. Next lesson, the file runner also picks an exit code.

## Tests first

Create `test/repl.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { repl } from "../src/repl.ts";

async function session(lines: string[]): Promise<string> {
  const input = PassThrough.from(lines.map((line) => `${line}\n`));
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk: Buffer) => (text += chunk.toString()));
  await repl(input, output);
  return text;
}

test("bare expressions are echoed", async () => {
  assert.equal(await session(["1 + 2"]), "> 3\n> ");
});

test("state survives between lines", async () => {
  assert.equal(await session(["let x = 20;", "x * 2"]), "> > 40\n> ");
});

test("errors are reported and the session continues", async () => {
  assert.equal(
    await session(["print -nil;", "print 1;"]),
    "> [1:7] Runtime error: Operand must be a number.\n> 1\n> ",
  );
});

test("empty lines are ignored", async () => {
  assert.equal(await session(["", "  "]), "> > > ");
});
```

Read the expected strings carefully, because they describe the REPL exactly:

- A prompt `> ` is written before the first line and after every line. Nobody is typing, so
  your input never appears in the output. That's why prompts sit right next to each other in
  `"> > 40\n> "`.
- `let x = 20;` is a statement. It prints nothing. `x * 2` is a bare expression, so its value
  is echoed.
- An error doesn't end the session. The next line still runs.
- The test callbacks are `async`, so `node:test` waits for the returned promise before it
  decides whether the test passed.
- `session` collects everything written to `output` in `text`. The arrow function's body is
  wrapped in parentheses because it's an assignment used as an expression.

Run both commands:

```sh
npm test
npm run typecheck
```

`npm test` fails with `ERR_MODULE_NOT_FOUND`: *Cannot find module '…/src/repl.ts' imported from
…/test/repl.test.ts*. The whole file can't load, so the runner counts it as one failed test:
`tests 92`, `pass 91`, `fail 1`. `tsc` says the same thing in its own words:
`error TS2307: Cannot find module '../src/repl.ts' or its corresponding type declarations.`

## The code

### `src/wyrm.ts`

This is new, the shared front door to the pipeline:

```ts
import type { Diagnostic } from "./diagnostic.ts";
import { formatDiagnostic, formatRuntimeError } from "./format.ts";
import type { Interpreter } from "./interpreter.ts";
import { parse, parseExpression } from "./parser.ts";
import { RuntimeError } from "./runtime-error.ts";
import { scan } from "./scanner.ts";
import { stringify } from "./value.ts";

export type Outcome =
  | { readonly kind: "ok" }
  | { readonly kind: "syntax-error"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "runtime-error"; readonly error: RuntimeError };

/** Scan, parse and run a whole program on the given interpreter. */
export function runSource(interpreter: Interpreter, source: string): Outcome {
  const scanned = scan(source);
  if (!scanned.ok) return { kind: "syntax-error", diagnostics: scanned.error };
  const parsed = parse(scanned.value);
  if (!parsed.ok) return { kind: "syntax-error", diagnostics: parsed.error };
  return guard(() => interpreter.interpret(parsed.value));
}

/**
 * REPL convenience: if `source` is a bare expression like `1 + 2` (no `;`),
 * evaluate it and return its printed value. Otherwise run it as a program.
 */
export function runLine(
  interpreter: Interpreter,
  source: string,
): { readonly outcome: Outcome; readonly echo: string | null } {
  const scanned = scan(source);
  if (scanned.ok) {
    const expr = parseExpression(scanned.value);
    if (expr.ok) {
      try {
        const echo = stringify(interpreter.evaluate(expr.value));
        return { outcome: { kind: "ok" }, echo };
      } catch (error) {
        if (!(error instanceof RuntimeError)) throw error;
        return { outcome: { kind: "runtime-error", error }, echo: null };
      }
    }
  }
  return { outcome: runSource(interpreter, source), echo: null };
}

export function formatOutcome(outcome: Outcome): string[] {
  switch (outcome.kind) {
    case "ok":
      return [];
    case "syntax-error":
      return outcome.diagnostics.map(formatDiagnostic);
    case "runtime-error":
      return [formatRuntimeError(outcome.error)];
  }
}

function guard(action: () => void): Outcome {
  try {
    action();
    return { kind: "ok" };
  } catch (error) {
    if (error instanceof RuntimeError) return { kind: "runtime-error", error };
    throw error;
  }
}
```

Notes:

- **`import type { Interpreter }`**: this module never does `new Interpreter()`. It only
  receives one as a parameter, so it only needs the type. `RuntimeError` is imported normally
  because `instanceof` needs the real class at runtime.
- **`runSource`** is the old `runWith` helper from the tests, except it *returns what happened*
  instead of formatting it. Deciding what happened and deciding how to show it are separate
  jobs.
- **`guard`** takes a callback of type `() => void`, runs it, and turns a thrown
  `RuntimeError` into an `Outcome`. Anything else (a `TypeError` from a bug in *your*
  TypeScript) is rethrown. Swallowing it would hide the bug.
- **`runLine`** tries the line as a single expression first. `parseExpression` (lesson 08)
  fails unless the *whole* line is one expression, so `1 + 2` succeeds and `let x = 1;` falls
  through to `runSource`. It has its own `try`/`catch` instead of using `guard` because it
  needs the *value*, and `guard`'s callback returns nothing.
- The return type of `runLine` is an inline object type. `echo` is `string | null`: `null`
  means "nothing to echo", which is different from echoing the string `"nil"`.
- **`formatOutcome`** has no `default` and no return after the `switch`. The `switch` covers
  every `kind`, so TypeScript knows the function always returns. Delete a case and the
  compiler complains that the function can fall off the end without returning a `string[]`
  (you'll try it in the drills).

### `src/repl.ts`

```ts
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { Interpreter } from "./interpreter.ts";
import { formatOutcome, runLine } from "./wyrm.ts";

export async function repl(input: Readable, output: Writable): Promise<void> {
  const interpreter = new Interpreter((line) => output.write(`${line}\n`));
  const lines = createInterface({ input, crlfDelay: Infinity });

  output.write("> ");
  for await (const line of lines) {
    if (line.trim() !== "") {
      const { outcome, echo } = runLine(interpreter, line);
      if (echo !== null) output.write(`${echo}\n`);
      for (const message of formatOutcome(outcome)) output.write(`${message}\n`);
    }
    output.write("> ");
  }
}
```

- **One interpreter for the whole session.** That's what makes `let x = 20;` on one line
  visible on the next: the globals live in that one `Interpreter`.
- `print` output goes to the same `output` stream as the echo and the errors, so in a test
  everything ends up in one string, in order.
- `createInterface({ input, crlfDelay: Infinity })` wraps the input stream in a line reader.
  `crlfDelay: Infinity` makes it treat `\r\n` (Windows line endings) as one line break, never
  two.
- `const { outcome, echo } = …` is object destructuring: two local names from one returned
  object.

> **Why `output.write("> ")` and not `rl.prompt()`?**
>
> readline has its own prompt feature: pass `output` and `prompt: "> "` to `createInterface`
> and call `.prompt()`. The first version of this REPL did that, and every test failed with
> `Error [ERR_USE_AFTER_CLOSE]: readline was closed`.
>
> Here's why. A `PassThrough.from([...])` delivers all its lines at once and then ends.
> readline reads them, queues them up for the `for await` loop, sees the end of the input, and
> **closes itself right away**, while your loop is still working through the queue. The next
> `.prompt()` then touches a closed interface and throws. A human typing slowly never triggers
> it, but short piped input always does.
>
> Writing the prompt straight to `output` doesn't involve readline at all, so there's nothing
> closed to touch. The lesson: short, instant, piped input is exactly what tests produce, and
> it finds timing bugs that manual testing never will.

### `src/main.ts`

The entry point, one statement using top-level `await`:

```ts
import { repl } from "./repl.ts";

await repl(process.stdin, process.stdout);
```

This is the only file that knows about `process.stdin` and `process.stdout`.

### Refactor `test/helpers.ts`

The helpers did the whole pipeline by hand. Now `runSource` and `formatOutcome` do it for them.
Replace the whole file with:

```ts
import { Interpreter } from "../src/interpreter.ts";
import type { Token, TokenType } from "../src/token.ts";
import { formatOutcome, runSource } from "../src/wyrm.ts";

export function tok(type: TokenType, lexeme: string = type): Token {
  return { type, lexeme, literal: null, line: 1, col: 1 };
}

export interface RunResult {
  readonly output: string[];
  readonly errors: string[];
}

/** Scan, parse and interpret `source`, collecting printed lines and formatted errors. */
export function run(source: string): RunResult {
  const output: string[] = [];
  const errors = runWith(new Interpreter((line) => output.push(line)), source);
  return { output, errors };
}

/** Like `run`, but reuses an existing interpreter (and its variables). Returns the errors. */
export function runWith(interpreter: Interpreter, source: string): string[] {
  return formatOutcome(runSource(interpreter, source));
}
```

What changed: the imports of `formatDiagnostic`, `formatRuntimeError`, `parse`,
`RuntimeError` and `scan` are gone, replaced by one import from `../src/wyrm.ts`. `runWith`
shrank from eleven lines to one. `tok`, `RunResult` and `run` are unchanged.

This is a **refactor**: the behaviour must not change. You don't need new tests for it, because
most of the 91 tests you already have (every test that runs wyrm code) go through `run` and
`runWith`. If they all still pass, the refactor is correct. That's what a test suite is for.

### Try it by hand

```sh
node src/main.ts
```

Type a few lines. Press **Ctrl-D** (end of input) to quit:

```
> let x = 20;
> x * 2
40
> fn sq(n) { return n * n; }
> sq(4)
16
> sq
<fn sq>
> print -nil;
[1:7] Runtime error: Operand must be a number.
> 1 +
[1:4] Error at end: Expect expression.
>
```

After Ctrl-D, the last `> ` stays on screen and your shell prompt appears after it. That's
fine. There's no `npm run wyrm` script yet; you'll add it in lesson 22.

## What you should see

`npm run check`: `tsc` prints nothing, then:

```
ℹ tests 95
ℹ pass 95
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Add an interactive REPL"
```

## Study Drills

1. **Break it on purpose.** Switch the REPL to readline's own prompt. Pass `output` and a
   `prompt` option to `createInterface`, and replace both `output.write("> ")` calls with a
   call to the interface's `prompt()` method. Run `npm test` and read the whole error: the
   code, the message, and which line of `repl.ts` the stack trace points at. Then pipe a few
   lines into the real program (`printf '1 + 2\n' | node src/main.ts`) and compare. Undo it.
2. Delete the `"runtime-error"` case from `formatOutcome`. Run `npm run typecheck` and read
   *both* errors: one is about the function's return, the other is about an import. Explain
   each in one sentence. Undo it.
3. In the REPL, predict the output of each of these before you press Enter, then check:
   `print 1` (no semicolon), `x = 5` (no `let`, no semicolon), `let y = 1` (no semicolon).
   For each, say whether `runLine` took the expression path or the `runSource` path.
4. **Explain in your own words** why `repl` takes a `Readable` and a `Writable` instead of
   using `process.stdin` and `process.stdout` directly. What would the tests have to do
   otherwise? Name one other place in wyrm that uses the same idea.
5. **Small extension.** Add a test to `test/repl.test.ts` showing that a function declared on
   one line can be called on a later line, and that a runtime error doesn't wipe the
   variables defined before it. It should pass without changing `src/`. Then delete it, so
   your test count matches the next lessons.
6. Look up `readline.createInterface` in the Node docs. Find `crlfDelay` and `terminal`. We
   don't pass `output` to readline, so it has no line editing or arrow-key history. Which
   option would you need to turn that on, and why would it make the tests harder?

## Checkpoint

Tell Claude: **"lesson 21 done"**. Expect questions like: *What does an `async` function
return, and why can't its return type be `void`? Why does `runLine` try `parseExpression`
before `runSource`? What exactly causes `ERR_USE_AFTER_CLOSE` with `rl.prompt()`? Why does
`wyrm.ts` use `import type` for `Interpreter` but a normal import for `RuntimeError`?*
