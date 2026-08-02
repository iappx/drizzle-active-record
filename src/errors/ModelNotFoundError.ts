export class ModelNotFoundError extends Error {
    public readonly modelName: string

    constructor(model: Function | string) {
        const modelName = typeof model === 'string' ? model : model?.name ?? 'Unknown'
        super(`Model ${modelName} not found`)
        this.name = 'ModelNotFoundError'
        this.modelName = modelName
    }
}
