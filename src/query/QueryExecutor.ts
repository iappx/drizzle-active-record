/**
 * The single gate every statement of this library passes through, reads and writes alike.
 *
 * @example
 * ```ts
 * const rows = await QueryExecutor.run(() => db.select().from(authorsTable))
 * ```
 */
export class QueryExecutor {
    /**
     * Runs a statement and rethrows a failure with the driver's own error text as `message`.
     *
     * The thrown error is the one drizzle raised: the statement stays on `.query` / `.params` and
     * the pg error on `.cause`, with its `code`, `detail` and `constraint`.
     *
     * @returns Whatever `fn` resolves to
     * @throws {Error} The error drizzle raised, with `message` taken from `cause.message`
     *
     * @example
     * ```ts
     * const authors = await QueryExecutor.run(() => db.query.authors.findMany())
     * ```
     */
    public static async run<T>(fn: () => Promise<T>): Promise<T> {
        try {
            return await fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            const cause = err?.cause
            if (cause?.message) {
                err.message = cause.message
            }
            throw err
        }
    }
}
