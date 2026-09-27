# Lesson 19 — Closures

## Goal

Make this work:

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

`makeCounter` has returned before `counter()` runs, but `inc` still reads and changes
`count`. A function that keeps its declaring environment alive like this is a **closure**.

The code change is five lines. The idea behind it is the most important one in the second half
of the course: **objects live as long as something refers to them**, not as long as the
function that created them.

## Concepts

### Where does a function look up names?

In lesson 17 you wrote this line in `WyrmFunction.call`, and were told it was deliberately
wrong:

```ts
const environment = new Environment(interpreter.globals);
```

Every call's environment hangs directly off the globals. So inside `inc`, the lookup chain for
`count` is: `inc`'s call environment (no `count`), then globals (no `count`), then error.
The environment where `count` actually lives, the one created for the call to
`makeCounter`, isn't in the chain at all.

It went unnoticed because every function so far was declared at the top level, where "the
environment it was declared in" *is* the globals. The two rules only differ for nested
functions.

The rule wyrm wants is **lexical scope**: a function body sees the variables that surround
its *declaration* in the source text. At runtime, "surround its declaration" means "the
environment that was current when the `fn` statement executed". So the function object has
to capture that environment and use it as the parent of every call's environment.

### Environments outlive calls

Here's what happens without closures, for a call to any function:

1. `call` creates a new `Environment`.
2. `executeBlock` makes it the current environment, runs the body, and in `finally` puts the
   previous environment back.
3. `call` returns. Nothing refers to that environment object any more.

JavaScript has a **garbage collector** (GC). Every so often it starts from the *roots* (the
current stack of calls, module-level variables, and so on), follows every reference, and frees
every object it can't reach. After step 3 the call's environment is unreachable, so it gets
collected. Its lifetime was exactly the call.

With closures, `makeCounter`'s body runs `fn inc() { … }`, which creates a `WyrmFunction`
holding a reference to the current environment, which is `makeCounter`'s call environment.
Then `return inc;` hands that function object out to the globals as `counter`. Now there is a
path from a root to the environment:

```
globals ──► counter ──► WyrmFunction(inc) ──closure──► makeCounter's call environment
```

So the GC keeps the environment alive, together with `count`. Nothing in wyrm or TypeScript
had to *decide* to keep it. Being reachable is all it takes. The environment lives until the
last function that closed over it becomes unreachable too.

Two consequences:

- **Closures capture the environment object, not a copy of the values.** `inc` doesn't store
  "count was 0". It stores a reference to the place where `count` lives, so assignments
  through it are visible to the next call.
- **Every call makes a new environment**, so every call to `makeCounter` produces a new,
  independent `count`. Two counters don't share anything.

The object graph has a cycle: the environment holds `inc` (it's a variable there), and `inc`
holds the environment. That's fine. JavaScript's GC works by reachability, so a cycle nobody
can reach is collected like anything else.

### The environment chain for `makeCounter`

During the first `counter()` call, while `count = count + 1` runs:

```
┌──────────────────────────────────────┐
│ globals                              │
│   makeCounter → <fn makeCounter>     │
│   counter     → <fn inc> ─────────┐  │
└──────────────────────────────────────┘
                 ▲                  │
                 │ enclosing        │ closure
┌────────────────┴─────────────┐    │
│ makeCounter call environment │◄───┘
│   count → 0                  │
│   inc   → <fn inc>  (the same object as counter)
└──────────────────────────────┘
                 ▲
                 │ enclosing
┌────────────────┴─────────────┐
│ inc call environment         │  ← current; created by counter()
│   (no variables)             │
└──────────────────────────────┘
```

Lookup of `count` starts at the bottom box, misses, follows `enclosing` up one box, and finds
it. `assign` walks the same chain, so it updates `count` in the middle box. When the call
ends, the bottom box becomes unreachable and is collected. The middle box stays, because
`counter` still points at `inc`, and `inc` points at it.

Call `makeCounter()` again and you get a second middle box with its own `count`, and a second
`inc` pointing at it.

## Tests first

Create `test/closures.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./helpers.ts";

test("a function remembers the variables around it", () => {
  const source = `
    fn makeCounter() {
      let count = 0;
      fn inc() {
        count = count + 1;
        return count;
      }
      return inc;
    }
    let counter = makeCounter();
    print counter();
    print counter();
  `;
  assert.deepEqual(run(source), { output: ["1", "2"], errors: [] });
});

test("each call creates a fresh closure", () => {
  const source = `
    fn makeCounter() {
      let count = 0;
      fn inc() { count = count + 1; return count; }
      return inc;
    }
    let a = makeCounter();
    let b = makeCounter();
    a(); a();
    print a();
    print b();
  `;
  assert.deepEqual(run(source).output, ["3", "1"]);
});

test("closures capture parameters too", () => {
  const source = `
    fn adder(n) {
      fn add(x) { return x + n; }
      return add;
    }
    let add5 = adder(5);
    print add5(10);
  `;
  assert.deepEqual(run(source).output, ["15"]);
});
```

**Stop. Don't run it yet.** Using the lookup chain from Concepts, write down on paper the
exact error the first test will report: the message, the line, and the column. Line 1 of
`source` is the empty line right after the backtick. Hint: in `count = count + 1`, which
`count` does the interpreter evaluate first?

Now run `npm test`. The first test fails with:

```
"[5:17] Runtime error: Undefined variable 'count'."
```

Line 5, column 17 is the *second* `count`, on the right-hand side. An assignment evaluates its
value before it assigns, so the read fails before the write gets a chance to. If you predicted
`Undefined variable 'count'`, you understood the bug. If you also predicted column 17, you
understood the evaluation order.

The other two tests fail the same way (`Undefined variable 'n'` in the third), but they only
compare `output`, so you see `actual: []`. `npm run typecheck` is clean. This is a behavior
bug, and there's no type in the program that says which environment is the right one.

## The code

### `src/function.ts`

Add a `closure` field right after `declaration`:

```ts
  readonly kind = "function";
  private readonly declaration: FunctionStmt;
  private readonly closure: Environment;
```

Take it as a second constructor parameter:

```ts
  constructor(declaration: FunctionStmt, closure: Environment) {
    this.declaration = declaration;
    this.closure = closure;
  }
```

`Environment` is already imported as a value (for `new Environment`), so using it as a type
too needs no import change.

Run `npm run typecheck`:

```
src/interpreter.ts(63,44): error TS2554: Expected 2 arguments, but got 1.
```

The compiler found the one place that creates functions. Before fixing that, finish this
file. In `call`, change the parent of the call environment from the globals to the closure:

```ts
    const environment = new Environment(this.closure);
```

The whole file should now read:

```ts
import type { FunctionStmt } from "./ast.ts";
import { Environment } from "./environment.ts";
import type { Interpreter } from "./interpreter.ts";
import type { Value } from "./value.ts";

export class WyrmFunction {
  readonly kind = "function";
  private readonly declaration: FunctionStmt;
  private readonly closure: Environment;

  constructor(declaration: FunctionStmt, closure: Environment) {
    this.declaration = declaration;
    this.closure = closure;
  }

  get arity(): number {
    return this.declaration.params.length;
  }

  call(interpreter: Interpreter, args: readonly Value[]): Value {
    const environment = new Environment(this.closure);
    this.declaration.params.forEach((param, i) => {
      environment.define(param, args[i] ?? null);
    });
    const completion = interpreter.executeBlock(this.declaration.body, environment);
    return completion.kind === "return" ? completion.value : null;
  }

  toString(): string {
    return `<fn ${this.declaration.name.lexeme}>`;
  }
}
```

(Compare, don't retype.) `call` still takes the interpreter, because it needs
`executeBlock`. It just doesn't use `interpreter.globals` any more.

`closure` is `private readonly`: it's set once at declaration time and never changes. Which
environment a function sees is fixed when it's *declared*, not when it's called. That's what
"lexical" means.

### `src/interpreter.ts`

In `execute`, the `"function"` case. Find:

```ts
        this.environment.define(stmt.name, new WyrmFunction(stmt));
```

Replace it with:

```ts
        this.environment.define(stmt.name, new WyrmFunction(stmt, this.environment));
```

`this.environment` at the moment the `fn` statement executes is the environment of the
surrounding scope. For a top-level function that's still the globals, which is why nothing
you wrote before changes behavior. Inside `makeCounter` it's that call's environment.

Notice the function is *defined into* the same environment it *captures*. That's what lets
`countdown` call itself: when its body looks up `countdown`, the lookup goes through the
closure and finds the function in it.

Run `npm run check`.

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 84
ℹ pass 84
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Give functions their closure environment"
```

## Study Drills

1. Change `this.environment` in the interpreter's `"function"` case to `this.globals`. Run
   `npm run typecheck` and `npm test`. The types are happy and the same three tests fail as
   before. In one sentence, explain why no type could have caught this. Then undo it.
2. Before running it, predict the output of this program:
   `let a = "global"; { fn show() { print a; } show(); let a = "block"; show(); }`.
   Run it with a temporary test. Draw the environment chain at each `show()` call and explain
   the output. Many people find the result surprising. Lesson 23 exists partly because of
   it. Delete the test.
3. Extend the counter on paper: write a wyrm `makeAccount(balance)` that returns a `deposit`
   function which adds to `balance` and returns the new balance. Draw its environment chain
   after two deposits. Optionally, add it as a test in `closures.test.ts`, get it green, then
   remove it so your tests match the lesson.
4. In your own words: when exactly does `makeCounter`'s call environment become unreachable,
   and what would have to happen in the program for the GC to collect it?
5. The environment holds `inc`, and `inc` holds the environment. Explain why that cycle
   doesn't cause a memory leak in JavaScript.

## Checkpoint

Tell Claude: **"lesson 19 done"**. Expect questions like: *What is the difference between the
environment a function is declared in and the one it's called from? Why did every earlier
test pass with `interpreter.globals`? Why do two counters from `makeCounter()` not share a
`count`? Why was the error at column 17 and not column 9?*
