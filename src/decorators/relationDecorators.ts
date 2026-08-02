import { ModelRegistry } from '../registry/ModelRegistry'

export function BelongsTo(target: () => Function, _opts?: Record<string, unknown>): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsTo',
            target,
        })
    }
}

export function HasMany(target: () => Function, _opts?: Record<string, unknown>): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'hasMany',
            target,
        })
    }
}

export function HasOne(target: () => Function, _opts?: Record<string, unknown>): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsTo',
            target,
        })
    }
}

export function BelongsToMany(target: () => Function, opts: { through: () => Function }): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsToMany',
            target,
            through: opts.through,
        })
    }
}
