# Lesson 16 — while

## Goal

Add loops:

```
let i = 0;
while (i < 3) {
  print i;
  i = i + 1;
}
```

With `while`, wyrm is **Turing-complete**: variables, conditions, and loops are enough to
compute anything a computer can. The code for today is small, maybe fifteen minutes. Use the
rest of the hour on the review section and the drills. You've built up a handful of patterns
over fifteen lessons, and this is the time to make sure they're solid before functions arrive
in lesson 17.

## Concepts

### A loop in the interpreter is a loop in TypeScript

A tree-walking interpreter implements a wyrm feature with the matching TypeScript feature.
wyrm's `if` became a TypeScript `if` in `execute`. wyrm's `while` becomes a TypeScript
`while`:

```ts
while (isTruthy(/* evaluate the condition */)) {
  /* execute the body */
}
```

The condition is re-evaluated before **every** iteration, including the first. If it starts
out falsy, the body never runs.

### Multi-line unions, one more time

`Stmt` gets its sixth member today. Like `Expr` in lesson 13, it gets rewritten one member per
line. That's purely formatting, but it pays off: adding the next member in lesson 17 is one
new line (plus moving the `;`), and the diff is easy to read.

### When a test passes before the code exists

Run the new tests before writing any code, and one of them will **pass**. That's worth
stopping for. It's covered below.

## Tests first

Add these three tests at the end of `test/control-flow.test.ts`:

```ts

test("while loops until the condition is falsy", () => {
  const source = `
    let i = 0;
    while (i < 3) {
      print i;
      i = i + 1;
    }
  `;
  assert.deepEqual(run(source).output, ["0", "1", "2"]);
});

test("a while whose condition starts falsy never runs", () => {
  assert.deepEqual(run('while (false) print "never";').output, []);
});

test("fizzbuzz-ish: nested control flow", () => {
  const source = `
    let i = 1;
    let total = 0;
    while (i <= 10) {
      if (i == 3 or i == 5) total = total + i;
      i = i + 1;
    }
    print total;
  `;
  assert.deepEqual(run(source).output, ["8"]);
});
```

The third test combines everything since lesson 12: `let`, assignment, a block, `while`, `if`,
`or`, and `==`. Only 3 and 5 match, so `total` is `8`.

Run `npm test`:

```
ℹ tests 69
ℹ pass 67
ℹ fail 2
```

Two failures, as expected. But `a while whose condition starts falsy never runs` **passes**.
The parser doesn't know `while` yet, so the program is a syntax error, nothing runs, and
`output` is `[]`, which is exactly what the test expects. The test is green for the wrong
reason. It checks `.output` but never `.errors`. A test you have never seen fail proves
nothing. This is exactly why "tests first" means *watch them fail*. You'll think about how to
strengthen it in the drills.

`npm run typecheck` is clean.

## The code

### `src/ast.ts`

At the end of the file, find:

```ts
export type Stmt = ExpressionStmt | PrintStmt | LetStmt | BlockStmt | IfStmt;
```

Replace it with:

```ts
export interface WhileStmt {
  readonly kind: "while";
  readonly condition: Expr;
  readonly body: Stmt;
}

export type Stmt =
  | ExpressionStmt
  | PrintStmt
  | LetStmt
  | BlockStmt
  | IfStmt
  | WhileStmt;
```

The body is a single `Stmt`. A loop with several statements uses a block as its body, just
like `if`.

Run `npm run typecheck`:

```
src/interpreter.ts(48,21): error TS2345: Argument of type 'WhileStmt' is not assignable to parameter of type 'never'.
```

One error this time. Only `execute` switches over `Stmt`.

### `src/interpreter.ts`

In `execute`, add a case after `"if"`, before `default`:

```ts
      case "while":
        while (isTruthy(this.evaluate(stmt.condition))) {
          this.execute(stmt.body);
        }
        return;
```

Look at `stmt` inside the loop. TypeScript narrowed it to `WhileStmt` at the `case`, and the
narrowing holds across the loop because `stmt` is a parameter nobody reassigns.

### `src/parser.ts`

In `statement()`, add a line after the `print` line:

```ts
  private statement(): Stmt {
    if (this.match("if")) return this.ifStatement();
    if (this.match("print")) return this.printStatement();
    if (this.match("while")) return this.whileStatement();
    if (this.match("{")) return { kind: "block", statements: this.block() };
    return this.expressionStatement();
  }
```

Add `whileStatement()` right after `ifStatement()`:

```ts
  private whileStatement(): Stmt {
    this.consume("(", "Expect '(' after 'while'.");
    const condition = this.expression();
    this.consume(")", "Expect ')' after condition.");
    const body = this.statement();
    return { kind: "while", condition, body };
  }
```

It's `ifStatement()` without the else. Note the error message is `Expect ')' after
condition.`, not `after while condition.`. Type it exactly.

`synchronize()` already stops at `while`: you listed it in lesson 12.

Run everything:

```sh
npm run check
```

## What you should see

`tsc` prints nothing, then:

```
ℹ tests 69
ℹ pass 69
ℹ fail 0
```

66 from before plus the 3 new tests in `control-flow.test.ts`.

Commit:

```sh
git add -A
git commit -m "Add while loops"
```

## Review: the patterns so far

Read this section slowly, and for each pattern find one real example in your own `src/`.

### 1. Union + `switch` + `assertNever`

The backbone of wyrm:

- **Data** is a union: `Expr`, `Stmt` and `Result` are discriminated by a field (`kind`,
  `ok`). `TokenType` is a union of string literals.
- **Behaviour** is a `switch` on the discriminant (`kind`, `ok`, `type`). Inside each `case`,
  TypeScript narrows to exactly one member, so you get its fields without casts.
- **Completeness** is enforced by `default: assertNever(x)`. When every member is handled, `x`
  has been narrowed to `never`. When you add a member, `x` is that member, which isn't
  `never`, and `tsc` points at every `switch` you still need to update.

You've now done "add a member, read the error list, work down it" in lessons 13, 14, 15, and
today. Lesson 17 adds two more members, one to each union.

The alternative, a `switch` with no `default` like `countNodes`, is also checked, but only
by the return type, and the message doesn't say what's missing. And an `if`/`else if`
chain isn't checked at all.

### 2. `Result` vs. `throw`

wyrm uses both, on purpose:

| | `Result<T, E>` | `throw` |
|---|---|---|
| Where | `scan()`, `parse()`, `parseExpression()` | inside the parser; the interpreter (`RuntimeError`) |
| Visible in the type? | Yes: the caller *must* check `ok` | No: any call might throw |
| Can hold many errors? | Yes: `Diagnostic[]` | One per throw |
| Good for | the boundary between stages | unwinding many nested calls at once |

The parser shows the combination. Deep inside `primary()`, `throw` gets you out of ten nested
calls in one step. At the statement boundary `parseProgram` catches it, and at the edge of the
module `parse()` turns everything into a `Result`. Callers of the parser never see an
exception for a syntax error.

Runtime errors are *thrown* all the way out of `interpret()`, because a runtime error stops
the program, and one error is all you'll ever get. `executeBlock`'s `finally` shows the price:
code that must clean up has to be ready for an exception on every line.

### 3. Narrowing instead of casting

Every time you needed a narrower type, you *proved* it to the compiler instead of asserting it:

| Technique | Example in wyrm |
|---|---|
| `typeof` | `binary()`: `typeof left === "number"` |
| discriminant check | `expr.kind === "variable"` in `assignment()` |
| `!== null` / `!== undefined` | `stmt.elseBranch !== null`, `value !== undefined` in `Environment.get` |
| `instanceof` | `error instanceof ParseError` in `parseProgram()` |
| type predicate | `isKeyword(word): word is Keyword` |
| assertion function | `assertNumber(operator, value): asserts value is number` |

No `as`, no `!`, no `any` anywhere in `src/`. When the compiler disagreed, the code changed
until it could see what you could see.

## Study Drills

wyrm can't run files yet (that's lesson 22), so to run a wyrm program, write it as a
**temporary** test using `run()`. Put scratch tests in a new file, `test/scratch.test.ts`, and
**delete that file** when you're done. At the end of the lesson, `npm test` must show 69 again.

1. **Break it on purpose.** In `execute`, delete the `case "while":` block. Read the `tsc`
   error, then run `npm test` and read the error there: which function's message is it, and
   why does it contain JSON? Then undo it.
2. **Factorial.** Write a wyrm program that prints `1`, `2`, `6`, `24`, `120` (the factorials of
   1 to 5) using only `let`, `while`, and assignment. Check it with a scratch test.
3. **FizzBuzz.** Write FizzBuzz for 1 to 15 in wyrm using only `while` and `if`. There's no `%`
   operator, so you'll need another way to find out whether a number is divisible by 3. (Hint:
   a counter that you reset.) Check the whole output list with a scratch test.
4. **Why green?** Explain in your own words why `a while whose condition starts falsy never
   runs` passed before `while` existed. Describe two different ways the test could be written
   so that it would have failed before today's code. Don't change the real test.
5. **Optional extension (then revert).** After committing, add a `for` loop as a *parser-only*
   desugaring: `for (let i = 0; i < 3; i = i + 1) print i;` becomes a block containing the `let`
   and a `while` whose body is a block with the original body followed by the increment. You'll
   need `for` as a keyword (look at `KEYWORDS`), but **no new AST node** and **no interpreter
   change**. Why is that possible? Prove it with a scratch test. Then throw it all away with
   `git restore .`, delete `test/scratch.test.ts`, and check that `git status` is clean.
6. Explain in your own words what happens if you run `while (true) {}` in a test, and why a
   tree-walking interpreter can't detect that ahead of time.

## Checkpoint

Tell Claude: **"lesson 16 done"**. Expect questions like: *Why did `tsc` report only one
error when you added `WhileStmt`, when adding `LogicalExpr` gave four? When does wyrm use
`Result` and when does it `throw`, and why both? What does `assertNever`'s parameter type
`never` actually check? How would you write a `for` loop without touching the interpreter?*
