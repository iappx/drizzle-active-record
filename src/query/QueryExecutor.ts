export class QueryExecutor {
    // surface the real pg error: drizzle wraps it as "Failed query" with the cause on err.cause
    public static async run<T>(fn: () => Promise<T>): Promise<T> {
        try {
            return await fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
            const cause = err?.cause
            if (cause?.message && !String(err?.message ?? '').includes(cause.message)) {
                err.message = `${err.message}\n  cause: ${cause.message}`
            }
            throw err
        }
    }
}
