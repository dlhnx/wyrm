# wyrm — Glossary

The words this project uses, and exactly what they mean here.

## Source to tokens

- **Source** — the text of a wyrm program, as one string.
- **Lexeme** — the exact slice of source text that makes up one token, e.g. `>=`, `count`, `"hi"` (including its quotes).
- **Token** — a lexeme plus what kind it is (its **token type**), its **literal** value if any, and its position (**line** and **column**, both starting at 1).
- **Keyword** — a word that looks like an identifier but is reserved: `and else false fn if let nil or print return true while`.
- **Scanner** — turns source into tokens. (Some books call it a *lexer* or *tokenizer*; here it's always *scanner*.)

## Tokens to trees

- **AST** (abstract syntax tree) — the tree form of a program that the parser builds.
- **Expression** — AST node that produces a value: `1 + 2`, `x`, `f(3)`, `a = b`.
- **Statement** — AST node that does something and produces no value: `print x;`, `let x = 1;`, `while (…) …`.
- **Declaration** — a statement that introduces a name: `let` or `fn`.
- **Parser** — turns tokens into statements and expressions.
- **Precedence** — which operator binds tighter: `*` over `+`, so `1 + 2 * 3` is `1 + (2 * 3)`.
- **Associativity** — how same-precedence operators group: `1 - 2 - 3` is `(1 - 2) - 3` (left); `a = b = c` is `a = (b = c)` (right).

## Errors

- **Diagnostic** — a problem found *before* running: by the scanner, parser or resolver. Diagnostics are collected, so one run can report several.
- **Syntax error** — any diagnostic. The program does not run at all.
- **Runtime error** — a problem found *while* running, e.g. `-"x"`. It stops the program at that point; output printed before it stays printed.

## Running

- **Value** — anything a wyrm expression can produce: a number, a string, a boolean, `nil`, or a callable.
- **nil** — the value meaning "nothing". The only value of its type.
- **Truthy / falsy** — how a value behaves as a condition. Only `false` and `nil` are falsy; everything else — including `0` and `""` — is truthy.
- **Equality** — `==` is true only for two values of the same type that are the same value. No conversions: `1 == "1"` is false. Two callables are equal only if they are the same callable.
- **Interpreter** — walks the AST and executes it. wyrm's interpreter is *tree-walking*: it evaluates the AST directly.
- **Evaluate** — compute the value of an expression.
- **Execute** — carry out a statement.
- **Output** — where `print` writes its lines. It is a plug-in point: the terminal in real use, an array in tests.

## Names and scope

- **Variable** — a name bound to a value by `let`, a parameter, or `fn`.
- **Scope** — the region of source where a name is visible. Every block `{ … }` and every function body opens a new one.
- **Global scope** — the outermost scope; where top-level `let`s, `fn`s, and native functions live.
- **Shadowing** — declaring a name in an inner scope that hides the same name from an outer one.
- **Redeclaration** — declaring a name twice in the *same* scope. Always an error in wyrm.
- **Environment** — the runtime storage for one scope: names → values, plus a link to the enclosing environment.

## Functions

- **Callable** — a value you can call with `( … )`: a wyrm function or a native function.
- **Arity** — how many arguments a callable expects. Calling with a different count is a runtime error.
- **Wyrm function** — a callable declared in wyrm code with `fn`.
- **Native function** — a callable built into the interpreter and written in TypeScript: `clock`, `len`, `str`, `sqrt`.
- **Closure** — a function together with the environment it was declared in. It keeps seeing (and changing) that environment's variables after the declaring function has returned.
- **Completion** — how a statement finished: *normally*, or *by returning* (carrying the returned value).

## Tools

- **REPL** — read-eval-print loop: type a line, see the result, keep going with the same variables. A bare expression without `;` is echoed.
- **File runner** — `wyrm path/to/script.wyrm`. Reports errors with the offending line and exits with a meaningful code.
- **Resolver** — a pass between parsing and running that works out, for each variable use, which declaration it refers to, and reports some errors early (e.g. `return` outside a function).
