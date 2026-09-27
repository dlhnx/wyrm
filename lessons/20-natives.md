# Lesson 20 — Native functions

## Goal

Give wyrm a few built-in functions written in TypeScript: `clock()`, `len(s)`, `str(x)` and
`sqrt(n)`. They live in the global scope, print as `<native fn len>`, obey the same arity
check as wyrm functions, and **check their argument types** at runtime:

```
len(42);   // [1:7] Runtime error: len expects (string) but got (number).
```

The interesting part is how you define one:

```ts
defineNative("len", ["string"], (s) => s.length)
```

There's no annotation on `s`, yet TypeScript knows it's a `string`, because the array
`["string"]` says so. The *same* list of names drives the runtime check and the static types,
so they can't disagree. Getting there is this lesson's generics workout: lookup types,
`keyof`, mapped tuple types, `const` type parameters, and a type predicate that ties it all
together.

Take the Concepts slowly. Each step builds on the one before.

## Concepts

The snippets here use a small, separate example: a command-line tool whose flags have kinds
`"int"`, `"text"` and `"bool"`. At the end of each step you'll see how it maps onto wyrm.

### Step 1: an interface as a lookup table

An interface doesn't have to describe objects you'll ever create. It can be a **table from
names to types**:

```ts
interface FlagTypes {
  int: number;
  text: string;
  bool: boolean;
}

type T1 = FlagTypes["text"];         // string
type T2 = FlagTypes["int" | "bool"]; // number | boolean
```

`FlagTypes["text"]` is an **indexed access type**: "the type of property `text`". Index with
a union and you get the union of the results. No `FlagTypes` object ever exists. The
interface is erased by type stripping like every other type, and it costs nothing at runtime.

In wyrm this is `TypeMap`. It maps each parameter type name that a native can ask for to the
TypeScript type of values with that name: `"nil"` to `null`, `"function"` to `Callable`, and
`"any"` to all of `Value`.

### Step 2: `keyof`

`keyof T` is the union of `T`'s property names:

```ts
type FlagKind = keyof FlagTypes; // "int" | "text" | "bool"
```

Deriving the union from the table means the two can never drift apart. Add a row to the
interface and the union grows with it. wyrm's `ParamType` is `keyof TypeMap`.

### Step 3: mapped types

A mapped type builds a new type by going over keys:

```ts
type Point = { x: number; y: number };
type Labels<T> = { [K in keyof T]: string };
type PL = Labels<Point>; // { x: string; y: string }
```

Read `[K in keyof T]` as a loop: "for each key `K` of `T`". The right side can use `K`, and
`T[K]` is "the type at that key".

### Step 4: mapped types over tuples

Here's the trick this lesson depends on. When the thing you map over is a **type parameter**
and it gets a **tuple**, the result is a tuple. The loop runs over the element positions and
leaves `length`, `push` and the other array members alone:

```ts
type Parsed<P extends readonly FlagKind[]> = { [K in keyof P]: FlagTypes[P[K]] };

type A1 = Parsed<["text", "int"]>; // [string, number]
```

Walk it through: `P` is `["text", "int"]`. For position `0`, `P[0]` is `"text"`, and
`FlagTypes["text"]` is `string`. For position `1`, you get `number`. Together, that's
`[string, number]`. Steps 1 to 3 combined in one line.

(The "type parameter" part matters. If you write the tuple directly,
`{ [K in keyof ["text", "int"]]: … }`, TypeScript maps *every* key of the array type,
including `"length"` and `"push"`, and you get a strange object instead of a tuple.
Always go through a generic like `Parsed<P>`.)

The constraint `P extends readonly FlagKind[]` does two things. It guarantees `P[K]` is a
valid key of `FlagTypes`. And because it says `readonly`, it accepts both mutable and readonly
arrays. A readonly array can't be passed where a mutable one is required, but a mutable one
is always fine where a readonly one is expected.

### Step 5: `-readonly`

Mapped types over tuples **preserve modifiers**. A readonly tuple in gives a readonly tuple
out:

```ts
type A2 = Parsed<readonly ["text", "int"]>; // readonly [string, number]
```

A `-` in front of a modifier *removes* it:

```ts
type Plain<P extends readonly FlagKind[]> = { -readonly [K in keyof P]: FlagTypes[P[K]] };

type A3 = Plain<readonly ["text", "int"]>; // [string, number]
```

`-?` does the same for optional properties. `+readonly` (or just `readonly`) adds the
modifier.

Why remove it? The tuple is going to describe a parameter list, and you'll see in Step 6
that the input will usually be readonly. A readonly tuple type is more restrictive to
work with. For example, you can't pass it where a plain `string[]` is expected
(`The type 'readonly [string]' is 'readonly' and cannot be assigned to the mutable type
'string[]'`). `-readonly` makes the result an ordinary tuple, whatever came in. wyrm's
`ArgsOf<P>` is exactly `Plain<P>` with `TypeMap`.

### Step 6: `const` type parameters

Now let a function infer `P` from an argument:

```ts
declare function kinds1<P extends readonly FlagKind[]>(p: P): P;
declare function kinds2<const P extends readonly FlagKind[]>(p: P): P;

kinds1(["text", "int"]); // P = ("int" | "text")[]
kinds2(["text", "int"]); // P = readonly ["text", "int"]
```

Without `const`, TypeScript infers the *array* type it usually would: the literals survive
(because the constraint asks for `FlagKind`s) but the order and the length are lost. Map
`("int" | "text")[]` through `Plain` and you get `(number | string)[]`, which is useless.

With `const`, TypeScript infers the most exact type it can, as if you'd written `as const` at
the call site. Because the constraint says `readonly`, you get an exact readonly tuple. The
constraint says `readonly` so that callers may pass readonly arrays too (Step 4), and the
readonly result is why Step 5's `-readonly` exists.

In wyrm, `defineNative` has `<const P extends readonly ParamType[]>`. The person calling it
writes a plain array literal and never needs `as const`.

### Step 7: rest parameters typed by a tuple

A rest parameter can have a tuple type, and then it means "exactly these parameters":

```ts
type F = (...args: [string, number]) => string;
// same as (a: string, b: number) => string

const f: F = (s, n) => s.repeat(n); // s: string, n: number, inferred
```

Now combine everything:

```ts
function command<const P extends readonly FlagKind[]>(
  name: string,
  kinds: P,
  run: (...args: Plain<P>) => string,
): string { /* … */ }

command("greet", ["text", "int"], (who, times) => who.repeat(times));
//                                  ^ string  ^ number
```

TypeScript infers `P` from the second argument, computes `Plain<P>`, and uses it as the
contextual type for the callback's parameters. That's `defineNative` exactly: `fn: (...args:
ArgsOf<P>) => Value`.

A callback may take *fewer* parameters than the tuple (it just ignores the rest), but not
more: an extra parameter would have no type to receive.

### Step 8: `Extract` picks members out of a union

`Extract<T, U>` keeps the members of the union `T` that are assignable to `U`:

```ts
type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number } | string | null;
type Objects = Extract<Shape, object>; // the circle and the square
```

It works member by member (TypeScript calls this *distributing* over the union), and it's the
type-level twin of the `typeof x === "object" && x !== null` check from lesson 17.

Applied to wyrm, `Extract<Value, object>` is `WyrmFunction | NativeFunction`: the callables.
The snapshot's `TypeMap` writes `function: Callable` because that name already exists and
reads better, but the two are the same type. `Extract` is how you'd derive "the object part
of a union" without listing the classes by hand.

### Step 9: the type predicate as the bridge

At runtime a native receives `readonly Value[]`: anything at all. The callback wants
`ArgsOf<P>`, for example `[string, number]`. Something has to get from one to the other, and
the rules say no `as`.

A **type predicate** is a function whose return type is `x is T`:

```ts
function isText(v: unknown): v is string {
  return typeof v === "string";
}
```

When it returns `true`, the caller's variable is narrowed to `T`. It's the *one sanctioned
bridge* from a runtime check to a static type. Why is this not just a cast in disguise?

- It only narrows **after a check actually ran**. An `as` asserts without looking at the
  value at all.
- The compiler still constrains it. `T` must be assignable to the parameter's type
  (`function f(x: number): x is string` is error TS2677), so you can only narrow *within* what
  the value could possibly be.
- The check lives in one named, testable function instead of being scattered around.

But be honest about the limit. **TypeScript does not verify that the body matches the
claim.** This compiles:

```ts
function badIsText(v: unknown): v is string {
  return typeof v === "number"; // lies
}
```

Every caller that trusts it can then crash at runtime with `v.toUpperCase is not a function`.
The predicate's correctness is on you. That's why wyrm has exactly one (`matches`), it's
short, and a test (`natives check argument types`) exercises it.

### Other pieces

**`_interpreter`.** `NativeFunction.call` receives the interpreter but never uses it.
`noUnusedParameters` would reject that. A leading underscore tells it "unused on purpose".
The parameter must stay, though: the interpreter calls `callee.call(this, args)` on a
`WyrmFunction | NativeFunction`, and calling a method on a union requires every member's
method to accept those arguments. Both classes need the same shape.

**Erasing the generic at the boundary.** `NativeFunction` itself is *not* generic. It stores
its implementation as `(args: readonly Value[]) => Value`. All the typed-tuple work happens
inside `defineNative`, which wraps the precise callback in a checked, untyped one. That's what
lets `NATIVES` be a plain `readonly NativeFunction[]` even though `len` and `clock` have
completely different parameter lists.

**`NativeError` becomes a `RuntimeError` at the call site.** A `RuntimeError` needs a token
for its `[line:col]`. A native has no idea where in the source it was called from. So natives
throw a `NativeError` (just a message), and the interpreter's `call`, which *does* have
`expr.paren`, catches it and rethrows a `RuntimeError` at that paren. Each piece of code
reports what it knows.

**`defineBuiltin` skips the redeclaration check.** `Environment.define` needs a `Token` (for
the error position) and refuses to declare a name twice. Natives have no token and are defined
before any program runs, so they get a separate method that takes a plain string and just
sets the value. Once they're in the globals map, `define` sees them like any other name.

**Where `Callable` lives.** `Callable` stays in `value.ts` and widens to
`WyrmFunction | NativeFunction`. `value.ts` is the hub every file already imports `Value`
from, so putting the list of callable classes there keeps one place that knows what a
**value** can be. `native.ts` imports it back (type-only) for `TypeMap`, which is the same
harmless type-only cycle as in lesson 17.

**`TypeName` vs `ParamType`.** `typeName(value)` answers "what is this value, at runtime?"
and can only say `"number" | "string" | "boolean" | "nil" | "function"`. `ParamType` is what a
native may *ask for*, which adds `"any"`. No value has the type name `"any"`, and the types say
so.

## Tests first

Create `test/natives.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { defineNative, NativeError, type ArgsOf } from "../src/native.ts";
import { Interpreter } from "../src/interpreter.ts";
import { run } from "./helpers.ts";

test("len and str", () => {
  assert.deepEqual(run('print len("wyrm"); print str(1) + "!";').output, ["4", "1!"]);
});

test("clock returns a number that moves forward", () => {
  assert.deepEqual(run("let a = clock(); let b = clock(); print b >= a;").output, ["true"]);
});

test("natives print as native functions", () => {
  assert.deepEqual(run("print len;").output, ["<native fn len>"]);
});

test("natives check argument types", () => {
  assert.deepEqual(run("len(42);").errors, [
    "[1:7] Runtime error: len expects (string) but got (number).",
  ]);
});

test("natives check arity like any function", () => {
  assert.deepEqual(run("len();").errors, ["[1:5] Runtime error: Expected 1 arguments but got 0."]);
});

test("natives can raise their own errors", () => {
  assert.deepEqual(run("sqrt(-1);").errors, ["[1:8] Runtime error: sqrt of a negative number."]);
});

test("defineNative infers parameter types", () => {
  const repeat = defineNative("repeat", ["string", "number"], (s, n) => s.repeat(n));
  assert.equal(repeat.arity, 2);
  // Type-level check: this line only compiles if ArgsOf maps names to types.
  const args: ArgsOf<["string", "number", "nil"]> = ["a", 1, null];
  assert.equal(args.length, 3);
  assert.throws(() => repeat.call(new Interpreter(), [1, 2]), NativeError);
});
```

Look at the last test closely. Two of its lines are tested by **the compiler, not by
`node:test`**:

- `(s, n) => s.repeat(n)` compiles only if inference gives `s: string` and `n: number`.
- `const args: ArgsOf<["string", "number", "nil"]> = ["a", 1, null];` compiles only if
  `ArgsOf` really turns those names into `[string, number, null]`.

At runtime, `args.length === 3` is trivially true. Type stripping deletes the annotation, so
`npm test` alone would pass even if `ArgsOf` were completely wrong. For that line,
`npm run typecheck` is the test runner. That's one more reason `npm run check` is the only
command that counts.

The last assertion calls `repeat.call` directly, skipping the interpreter's `call`, so nothing
converts the error. You get the raw `NativeError`.

Run `npm test`. The whole file fails before any test runs:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/native.ts' imported from .../test/natives.test.ts
```

Run `npm run typecheck`:

```
test/natives.test.ts(3,56): error TS2307: Cannot find module '../src/native.ts' or its corresponding type declarations.
test/natives.test.ts(34,64): error TS7006: Parameter 's' implicitly has an 'any' type.
test/natives.test.ts(34,67): error TS7006: Parameter 'n' implicitly has an 'any' type.
```

The second and third errors are the type-level test already speaking. With no `defineNative`
to infer from, `s` and `n` have no type.

## The code

### `src/value.ts`: runtime type names

Append to the end of the file:

```ts
export type TypeName = "number" | "string" | "boolean" | "nil" | "function";

export function typeName(value: Value): TypeName {
  if (value === null) return "nil";
  switch (typeof value) {
    case "number": return "number";
    case "string": return "string";
    case "boolean": return "boolean";
    default: return "function";
  }
}
```

After the `null` check, `typeof` can only be `"number"`, `"string"`, `"boolean"`, or
`"object"` for a callable. `default` catches the last one. Each `case` returns a literal, which
TypeScript checks against `TypeName`. A typo like `return "bool";` is an error.

### `src/native.ts`

Create the file:

```ts
import type { Interpreter } from "./interpreter.ts";
import { stringify, typeName, type Callable, type Value } from "./value.ts";

/** Maps a parameter type name to the TypeScript type of its values. */
interface TypeMap {
  number: number;
  string: string;
  boolean: boolean;
  nil: null;
  function: Callable;
  any: Value;
}

export type ParamType = keyof TypeMap;

/** Turns a tuple of type names into a tuple of TypeScript types:
 *  ["string", "number"] -> [string, number] */
export type ArgsOf<P extends readonly ParamType[]> = {
  -readonly [K in keyof P]: TypeMap[P[K]];
};

/** Thrown by natives; the interpreter turns it into a RuntimeError at the call site. */
export class NativeError extends Error {
  override readonly name = "NativeError";
}

export class NativeFunction {
  readonly kind = "native";
  readonly name: string;
  private readonly params: readonly ParamType[];
  private readonly impl: (args: readonly Value[]) => Value;

  constructor(name: string, params: readonly ParamType[], impl: (args: readonly Value[]) => Value) {
    this.name = name;
    this.params = params;
    this.impl = impl;
  }

  get arity(): number {
    return this.params.length;
  }

  call(_interpreter: Interpreter, args: readonly Value[]): Value {
    return this.impl(args);
  }

  toString(): string {
    return `<native fn ${this.name}>`;
  }
}

export function defineNative<const P extends readonly ParamType[]>(
  name: string,
  params: P,
  fn: (...args: ArgsOf<P>) => Value,
): NativeFunction {
  return new NativeFunction(name, params, (args) => {
    if (!matches(params, args)) {
      const expected = params.join(", ");
      const got = args.map(typeName).join(", ");
      throw new NativeError(`${name} expects (${expected}) but got (${got}).`);
    }
    return fn(...args);
  });
}

function matches<P extends readonly ParamType[]>(
  params: P,
  args: readonly Value[],
): args is ArgsOf<P> {
  return params.every((param, i) => {
    const arg = args[i];
    return arg !== undefined && (param === "any" || typeName(arg) === param);
  });
}

export const NATIVES: readonly NativeFunction[] = [
  defineNative("clock", [], () => performance.now() / 1000),
  defineNative("len", ["string"], (s) => s.length),
  defineNative("str", ["any"], (value) => stringify(value)),
  defineNative("sqrt", ["number"], (n) => {
    if (n < 0) throw new NativeError("sqrt of a negative number.");
    return Math.sqrt(n);
  }),
];
```

Now read it top to bottom with the Concepts next to it.

- **`TypeMap`, `ParamType`, `ArgsOf`** are Steps 1, 2 and 4–5. `TypeMap` isn't exported:
  nothing outside needs the table, only the two types built from it.
- **`NativeError`** has no constructor. It inherits `Error(message)`. `override readonly
  name` is the same pattern as `RuntimeError` and `ParseError`.
- **`NativeFunction`** mirrors `WyrmFunction`: a literal `kind` (`"native"`, so the two are
  distinguishable), an `arity` getter, `call`, and `toString`. Its `name` is public because the
  interpreter uses it to register the native in the globals.
- **`defineNative`** is where the generic lives. The inner arrow `(args) => { … }` gets its
  parameter type from `NativeFunction`'s constructor: `readonly Value[]`. Inside, `if
  (!matches(params, args)) throw …` narrows `args` to `ArgsOf<P>` for the rest of the block,
  so `fn(...args)` type-checks. Without that `if`, `fn(...args)` is an error, and that's the
  point.
- **`matches`** is the type predicate from Step 9. It's generic in `P` so that its claim,
  `args is ArgsOf<P>`, is about the *same* `P` that `defineNative` has. `args[i]` is
  `Value | undefined` under `noUncheckedIndexedAccess`, and `typeName` wants a `Value`, hence
  `arg !== undefined`. `"any"` accepts anything. Everything else must match `typeName`
  exactly. This is the function whose correctness is on you.
- **`NATIVES`** shows the payoff. No parameter has an annotation, and all of them are
  typed: `s: string`, `value: Value`, `n: number`. `clock` has `[]`, so `P` is `readonly []`
  and the callback takes nothing. `sqrt` throws a `NativeError` for its own domain error.

`performance` is a global in Node, typed by `@types/node`, and needs no import.

### `src/environment.ts`

Add `defineBuiltin` right after `define`:

```ts
  /** Define a built-in by plain name (no token, no redeclaration check). */
  defineBuiltin(name: string, value: Value): void {
    this.values.set(name, value);
  }
```

### `src/interpreter.ts`

Add the import, after the `function.ts` import:

```ts
import { WyrmFunction } from "./function.ts";
import { NATIVES, NativeError } from "./native.ts";
import { assertNumber, RuntimeError } from "./runtime-error.ts";
```

Both are values: `NATIVES` is an array and `NativeError` is used with `instanceof`. So this
is a normal import, and `interpreter.ts → native.ts` is a real runtime edge. The way back,
`native.ts → interpreter.ts`, is `import type`, so there's still no runtime cycle.

Register the natives in the constructor:

```ts
  constructor(output: Output = console.log) {
    this.output = output;
    for (const native of NATIVES) {
      this.globals.defineBuiltin(native.name, native);
    }
  }
```

Every `new Interpreter()` gets them, including the one in each test's `run`.

In `call`, find the last line:

```ts
    return callee.call(this, args);
```

Replace it with:

```ts
    try {
      return callee.call(this, args);
    } catch (error) {
      if (error instanceof NativeError) throw new RuntimeError(expr.paren, error.message);
      throw error;
    }
```

`error` in a `catch` is `unknown`. `instanceof` narrows it. Anything that isn't a
`NativeError`, including a `RuntimeError` from deeper inside a wyrm function, is rethrown
untouched.

Run `npm run typecheck`:

```
src/interpreter.ts(26,47): error TS2345: Argument of type 'NativeFunction' is not assignable to parameter of type 'Value'.
  Type 'NativeFunction' is missing the following properties from type 'WyrmFunction': declaration, closure
```

Of course: a native isn't a **value** yet, so it can't go into an environment. The second
line shows TypeScript checking the class structurally. It tried to see `NativeFunction` as a
`WyrmFunction` and found fields missing.

### `src/value.ts`: widen `Callable`

At the top of `value.ts`, find:

```ts
import type { WyrmFunction } from "./function.ts";

export type Callable = WyrmFunction;
```

Replace it with:

```ts
import type { WyrmFunction } from "./function.ts";
import type { NativeFunction } from "./native.ts";

export type Callable = WyrmFunction | NativeFunction;
```

That's the one change that makes natives values. Now look at what you *didn't* have to
change: the guard in `call` (`typeof callee !== "object" || callee === null`) removes
non-callables, whatever `Callable` contains, so it narrows to the new union for free.
`callee.arity` and `callee.call(this, args)` work because both classes have them with
compatible types. `stringify` still uses `toString()`. `isEqual` still compares by identity.

Run `npm run check`.

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 91
ℹ pass 91
ℹ fail 0
```

Commit:

```sh
git add -A
git commit -m "Add native functions with typed params"
```

## Study Drills

1. Add a native `floor` that takes one `"number"` and rounds it down, without annotating its
   parameter. Hover over the parameter to confirm its type. Write a temporary test that
   `print floor(2.7);` prints `2` and that `floor("x");` gives the right error. Then remove the
   native and the test so your code matches the lesson.
2. Break it on purpose: change `len`'s parameter list to `["number"]` but leave the callback
   as it is. Read the exact error (which line, which property, which type). Explain how that
   error was *computed* from `["number"]`, step by step through `ArgsOf` and `TypeMap`. Then
   undo it.
3. Remove `const` from `defineNative`'s type parameter. Only one error appears, and it's in the
   test file, not in `NATIVES`. Read it, then explain why `len`, `str` and `sqrt` survived
   without `const` but `repeat` didn't. (Hint: what does `("string")[]` map to, and what does
   `("string" | "number")[]` map to?) Then undo it.
4. Remove `-readonly` from `ArgsOf`. Surprise: everything still compiles. Hover over `ArgsOf`
   in the test and in `defineNative` and describe what changed. Then explain in your own
   words what `-readonly` protects against, using the TS4104 message from Concepts. Undo it.
5. Rename `_interpreter` to `interpreter` and read the error. Then try deleting the parameter
   entirely and read the error in `interpreter.ts`. Explain why the union forces both classes
   to have the same `call` shape. Undo both.
6. Before running it, predict what `let len = 5;` at the top level of a wyrm program does, and
   what `{ let len = 5; print len; }` does. Check with temporary tests, then delete them.
   Explain both results using `defineBuiltin` and `define`.

## Checkpoint

Tell Claude: **"lesson 20 done"**. Expect questions like: *Walk me through how
`ArgsOf<["string", "number"]>` becomes `[string, number]`. What does `const` change about
inference for `["string", "number"]`? Why is `matches` not a cast, and what could go wrong if
its body were wrong? Why does a native throw `NativeError` instead of `RuntimeError`?
Which line of the tests is checked only by `tsc`?*
