import { ModelRegistry } from '../registry/ModelRegistry'
import { TRelationOptions } from '../types/metadata'

export function BelongsTo(target: () => Function, opts?: TRelationOptions): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsTo',
            target,
            foreignKey: opts?.foreignKey,
            targetKey: opts?.targetKey,
        })
    }
}

export function HasMany(target: () => Function, opts?: TRelationOptions): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'hasMany',
            target,
            foreignKey: opts?.foreignKey,
            sourceKey: opts?.sourceKey,
        })
    }
}

// registered as a belongsTo: the foreign key is expected on the declaring model, exactly
// as for @BelongsTo — { foreignKey } therefore names a column of the declaring model, and
// { targetKey } one of the target
export function HasOne(target: () => Function, opts?: TRelationOptions): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsTo',
            target,
            foreignKey: opts?.foreignKey,
            targetKey: opts?.targetKey,
        })
    }
}

// `targetKey` is deliberately absent: the far hop of a many-to-many is the junction's own
// @BelongsTo to the target, so the column it lands on is that relation's { targetKey }
export function BelongsToMany(
    target: () => Function,
    opts: Omit<TRelationOptions, 'targetKey'> & { through: () => Function },
): PropertyDecorator {
    return (t, propertyKey) => {
        ModelRegistry.defineRelation(t.constructor, {
            propertyKey: String(propertyKey),
            kind: 'belongsToMany',
            target,
            through: opts.through,
            foreignKey: opts.foreignKey,
            sourceKey: opts.sourceKey,
            otherKey: opts.otherKey,
        })
    }
}
