/**
 * Thrown when a lookup that must return a row finds none.
 *
 * Raised by `tryGetOne()` and `tryFindByPk()` unless `Orm.init` was given a
 * `modelNotFoundErrorFactory`.
 *
 * @example
 * ```ts
 * try {
 *     await Author.tryFindByPk(42)
 * } catch (e) {
 *     if (e instanceof ModelNotFoundError) {
 *         console.log(e.modelName) // 'Author'
 *     }
 * }
 * ```
 */
export class ModelNotFoundError extends Error {
    /** Name of the model class that was looked up, or `Unknown` when it could not be determined. */
    public readonly modelName: string

    /**
     * Builds the error with the message `Model <name> not found`.
     *
     * @param model The model class, or its name when the class is not at hand
     */
    constructor(model: Function | string) {
        const modelName = typeof model === 'string' ? model : model?.name ?? 'Unknown'
        super(`Model ${modelName} not found`)
        this.name = 'ModelNotFoundError'
        this.modelName = modelName
    }
}
