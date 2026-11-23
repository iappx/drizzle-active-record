# CLAUDE.md — Project Rules

Conventions for working with this codebase: formatting, file structure, naming, TypeScript usage,
documentation comments and tests. Everything here applies to `src/` and `test/` alike.

This is a published library: every exported symbol is public API. The rules about documentation
comments (§3) are therefore stricter than in an application.

## Commands

```bash
npm run build          # rimraf ./lib && tsc -p tsconfig.json
npm test               # jest
npm run test:coverage  # jest --coverage
```

## 1. Code Style

### 1.1 Formatting

| Rule | Value |
|---|---|
| Indentation | 4 spaces, never tabs |
| Continuation indent | 4 spaces |
| Line endings | LF, final newline required |
| Line length | 120 characters |
| Semicolons | **never** at end of statement |
| Quotes | single (`'value'`); backticks only for interpolation and multi-line SQL |
| Template interpolation | tight — `${value}`, not `${ value }` |
| Object literal braces | spaces inside — `{ as: 'a2' }` |
| Import braces | spaces inside — `import { sql, SQL } from 'drizzle-orm'` |
| Trailing comma | required in multi-line lists, forbidden in single-line ones |
| Braces on `if` | always, even for a single statement |
| Brace placement | end of line — `class X {`, `} else {`, `} catch (e) {` |
| Blank lines | 1 between members, 1 after the import block, never 2 in a row |
| Arrow parameters | omit parentheses for one untyped parameter — `value => value.name` |
| Multi-line chains | dot starts the line, indented one level |

Multi-line signatures put one parameter per line, with a trailing comma, and close on their own line
together with the return type:

```ts
public static bulkUpsert<M extends BaseModel>(
    this: ModelCtor<M>,
    rows: MCreationAttributes<M>[],
    opts: TBulkUpsertOpts<M>,
): Promise<M[]> {
```

Long chains break with the dot leading:

```ts
const list = await TrainingProgram.query()
    .where({ userId })
    .includeModel(TrainingExercise)
        .where({ isActive: true })
    .endInclude()
    .getAll()
```

### 1.2 File structure

- **One file — one class.** A file may additionally export the types that only that class uses.
- **The filename is the class name**, in PascalCase: class `TableRef` → `src/query/TableRef.ts`.
- Files that export no class are named after what they export, in camelCase for a group of loose
  declarations (`columnDecorators.ts`, `metadata.ts`) and PascalCase for a single named concept
  (`Op.ts`, `Fn.ts`).
- Modules are grouped by role: `connection/`, `decorators/`, `dialect/`, `errors/`, `filter/`,
  `model/`, `naming/`, `query/`, `registry/`, `schema/`, `sql/`, `types/`, `utils/`.
- Tests never live next to the source. They live in `test/`, mirroring the `src/` layout.

### 1.3 Naming

| Entity | Rule | Example |
|---|---|---|
| Class | `PascalCase`, no exceptions | `DBModelQuery`, `SchemaBuilder`, `BoundValue` |
| Type alias | prefix **`T`** | `TWhere`, `TColumnMeta`, `TRelationKind` |
| Interface | prefix **`I`** | `INamingStrategy`, `ISchemaDialect`, `IColumnSource` |
| Generic parameter | single letter for a model or attribute set (`M`, `CA`), `T`-prefixed word when the meaning needs stating | `M extends BaseModel`, `TModel` |
| Method, property, variable | `camelCase` | `getAll`, `primaryKeyAttribute` |
| Module-level constant | `SCREAMING_SNAKE_CASE` | `INTEGRAL_COLUMN_TYPES` |
| Private field | `private` / `private readonly`, no underscore prefix | `private readonly conditions: TWhere[]` |
| Unused parameter | prefix `_` | `_target` |
| Error class | `<What><Problem>Error` | `ModelNotFoundError` |
| Database table / column name | `snake_case`, produced by the naming strategy | `authors`, `first_name` |

Access modifiers are written out explicitly on class members (`public`, `private`, `protected`) —
this is a library, and the modifier is part of the contract a reader checks.

`#private` fields are not used; `private` is.

### 1.4 Types vs interfaces

A `type` describes data. An `interface` describes behaviour and contains method signatures.

```ts
// ❌ Wrong — an interface holding only fields
export interface IColumnMeta {
    propertyKey: string
    columnName: string
}

// ✅ Correct — a type for a data structure
export type TColumnMeta = {
    propertyKey: string
    columnName: string
}

// ✅ Correct — an interface for behaviour
export interface INamingStrategy {
    columnName(propertyKey: string): string
}
```

### 1.5 Imports and exports

- Imports form **one block with no blank lines inside it**, followed by exactly one blank line.
- Paths are relative (`'./types'`, `'../query/TableRef'`). There are no path aliases.
- `import type` is used when only the type is needed — `import type { TableRef } from '../query/TableRef'`.
- **Named exports only.** `export default` is not used anywhere.
- Every directory has a barrel `index.ts` containing nothing but `export * from './X'` lines.
- `src/index.ts` is the single public entry point: it re-exports every barrel, plus the
  `drizzle-orm` symbols consumers need in order to build raw fragments against the same instance.

### 1.6 Class member order

1. `static` fields and constants
2. instance fields
3. `constructor`
4. public methods
5. protected methods
6. private methods

Constructor parameter properties are used for immutable dependencies, one per line with a trailing
comma:

```ts
export class PendingExists {
    constructor(
        public readonly model: new () => any,
        public readonly conditions: TWhere[],
        public readonly as?: string,
        public readonly negated = false,
    ) {}
}
```

### 1.7 TypeScript

- **Every function and method declares its return type explicitly**, `void` included.
- `readonly` on anything that is not reassigned after construction.
- `unknown` is the type for a value of unconstrained shape. `any` is allowed only where a Drizzle
  internal has no public type, and each occurrence carries
  `// eslint-disable-next-line @typescript-eslint/no-explicit-any` on the line above it.
- `null` means "no row / no value" in results; `undefined` means "argument not supplied".
- Union types of string literals instead of `enum`.
- Optional parameters use `?` when absence is meaningful and a default when it is not:
  `ref(opts?: { as?: string })`, `negated = false`.
- Casts use `as`. `as const` and `satisfies` are not used.
- Utility types in use: `Partial<T>`, `Record<K, V>`, `Omit<T, K>`, `keyof`.

### 1.8 Async and errors

- `async` / `await` only. No hand-built `new Promise(...)`.
- The return type is always spelled `Promise<T>`.
- No local `try/catch` for control flow. Invalid input throws immediately, with a message naming the
  model, column or key involved:

```ts
throw new Error(`Unknown column "${key}" on ${this.modelName}`)
```

- Domain failures use a dedicated error class in `src/errors/` (`ModelNotFoundError`).

## 2. Documentation comments (JSDoc)

### 2.1 Where a doc block is required

A JSDoc block is **mandatory** on:

- every exported class;
- every **public method** of an exported class, including `static` ones;
- every exported function;
- every exported type, interface and constant;
- every field of an exported type whose meaning is not fixed by its name.

`private` and `protected` members do not get doc blocks. Name them so they do not need one.

Overloads carry the block on each overload declaration, or one block above the group. The
implementation signature never carries one — it is not part of the public surface.

### 2.2 What a doc block contains

**Current behaviour and how to call it. Nothing else.**

1. One sentence in the present tense saying what the member does.
2. Optional short paragraph on observable behaviour: what it returns for an empty input, what it
   mutates, what it does not do.
3. `@param` / `@returns` / `@throws` where they add a fact the signature does not carry.
4. `@example` with a realistic call. Required on anything a consumer chains or configures.

```ts
/**
 * Adds a correlated `EXISTS` sub-query over a relation of this model.
 *
 * Conditions are applied to the related table, not the outer one. Soft-deleted rows are excluded
 * when the related model is `paranoid`.
 *
 * @param relation Property key of the relation declared on this model
 * @param conditions Conditions applied inside the sub-query
 * @returns The same query, for chaining
 * @throws {Error} When the model declares no relation under that key
 *
 * @example
 * ```ts
 * const authors = await Author.query()
 *     .whereExists('books', { isPublished: true })
 *     .getAll()
 * ```
 */
public whereExists(relation: TRelationKey<M>, conditions: TWhere): this {
```

### 2.3 What a doc block must never contain

- **History.** No "previously", "used to", "replaces", "this was moved from", "now also supports".
- **Retrospective.** No account of what was tried, what broke, what an earlier version did.
- **Rationale.** No "why it is done this way", no comparison with the approach that was rejected, no
  trade-off discussion, no defence of a design.
- **An essay.** If the block runs past ten lines, it has stopped documenting and started arguing.
- **A restatement of the signature.** `@param id The id` earns nothing.
- **Types in tags.** Write `@param column`, never `@param {Column} column`. The signature has the
  type. `@throws {Error}` is the one place a type is written, because there is no signature for it.

```ts
// ❌ Wrong — rationale, history and an argument about design
/**
 * The value a condition finally binds, adjusted for the column it is compared against.
 *
 * The one adjustment made here is for a fractional number against an integer column. Comparing
 * `id = 1.5` is a legitimate question with the answer "no row" — Postgres resolves the literal form
 * as `integer = numeric` and returns nothing. As a bind parameter the same value is typed from the
 * column instead, so the server fails the whole statement. Binding it as `numeric` restores the
 * literal form's meaning, and keeps ordering comparisons meaningful rather than fatal.
 */

// ✅ Correct — what it does now, and how it is called
/**
 * Prepares a value for binding against a specific column.
 *
 * A fractional number compared against an integer column is bound as `numeric`, so the comparison
 * yields no rows instead of failing. Every other value is returned unchanged.
 *
 * @example
 * ```ts
 * BoundValue.for(Author.column('id'), 1.5) // sql`1.5::numeric`
 * BoundValue.for(Author.column('name'), 'Ann') // 'Ann'
 * ```
 */
```

### 2.4 Language and format

- English, present tense, third person: "Returns", "Adds", "Throws".
- One-line form for a short fact: `/** The underlying drizzle column, for raw `sql` fragments. */`
- Multi-line blocks open on their own line, one space before each `*`.
- `@example` bodies are fenced with ```ts and show a real call, not pseudocode.
- Tags in this order: `@param`, `@returns`, `@throws`, `@example`, `@deprecated`.
- `@example` goes last. TypeScript's JSDoc parser reads a line-initial `@` inside a fence as a tag,
  so an example containing decorators (`@Table`, `@NamedColumn`) splits into pseudo-tags in IDE
  hover. Leading whitespace does not prevent it. The example text still reads, and any tag placed
  after it would be swallowed — hence last.

## 3. Inline comments

Inline `//` comments are the exception, not the norm. The code says what it does; the doc block says
what it offers.

**Write one only for what the code cannot say:**

- a constraint that lives outside this file — a Postgres behaviour, a Drizzle internal, an
  ordering requirement between two calls;
- a literal that would otherwise look arbitrary;
- a trap the next reader would walk into.

One line. Two if the trap genuinely needs two.

**Never write:**

- a retelling of the line below (`// increment the counter`);
- a section banner (`// ===== Builders =====`);
- a note addressed to a reviewer;
- a summary of the algorithm written underneath;
- commented-out code;
- history or rationale in any form — the same ban as §2.3.

`// eslint-disable-next-line` and `// @ts-expect-error` are directives, not comments, and are exempt.

## 4. Tests

- Jest with `ts-jest`. Config in `jest.config.js`, spec pattern `\.spec\.ts$`.
- Specs live in `test/`, mirroring `src/`: `test/query/TableRef.spec.ts` covers `src/query/TableRef.ts`.
- Model fixtures live in `test/fixtures/` and are shared across specs (`testModels.ts`,
  `treeModels.ts`, `typeModels.ts`).
- SQL is asserted by rendering a real Drizzle statement against a pool that never connects, then
  checking `sql` text and `params`:

```ts
const toSql = (fragment: { queryChunks: unknown }): { sql: string; params: unknown[] } => {
    const built = db.dialect.sqlToQuery(fragment)
    return { sql: built.sql, params: built.params }
}
```

- The outer `describe` names the unit and the aspect: `describe('TableRef.of / Model.ref — building a reference')`.
- `it` is a lowercase statement of the behaviour: `it('an unaliased ref is the real table')`.
- Assertions are plain Jest — `toBe`, `toEqual`, `toContain`, `toThrow`. Errors are matched by
  regular expression on the message: `.toThrow(/Unknown column "nope" on authors/)`.
- Test files follow every rule above, comments included. A comment naming the case belongs in the
  `it` string.
