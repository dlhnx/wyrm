# 1. Run TypeScript with Node's native type stripping, no build step

Date: 2026-09-27

## Status

Accepted

## Context

Node 24 can run `.ts` files directly: it erases the type annotations and runs what's left. It does **not** type-check. The alternative is a classic build: `tsc` compiles `src/` to `dist/`, then Node runs the `.js`.

## Decision

Run `.ts` directly with Node (`node src/main.ts`, `node --test`). `tsc` is used only as a checker (`noEmit: true`).

That forces these compiler settings:

- `erasableSyntaxOnly` — only syntax that can be deleted to leave valid JavaScript. That rules out `enum`, `namespace`, and constructor parameter properties (`constructor(private x: number)`).
- `allowImportingTsExtensions` — imports say `./scanner.ts`, which is the file that actually exists at runtime.
- `verbatimModuleSyntax` — type-only imports must say `import type`, so the stripper knows it can delete them.

## Consequences

- No `dist/` folder, no stale build output, no source maps. Edit and run.
- `enum` is not available. We use unions of string literals (`"+" | "-"`), which is also the more idiomatic modern TypeScript.
- Class fields are declared and assigned explicitly instead of using parameter properties. It's more typing, which suits a hand-typing course.
- **Running is not checking.** A program with type errors still runs. `npm run check` (typecheck + test) is the only real signal.
- The type stripper is not the TypeScript compiler, and it has edge cases. For example, a method named `declare` right after `private` is misread as the TS `declare` modifier.
