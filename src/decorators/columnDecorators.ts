import { ModelRegistry } from '../registry/ModelRegistry'
import { TColumnOptions, TColumnRole, TDbDataType } from '../types/metadata'

export function NamedColumn(dataType: TDbDataType, columnName?: string, options: TColumnOptions = {}): PropertyDecorator {
    return (target, propertyKey) => {
        const key = String(propertyKey)
        ModelRegistry.defineColumn(target.constructor, {
            propertyKey: key,
            columnName,
            dataType,
            options,
        })
    }
}

function timestampRole(role: TColumnRole): PropertyDecorator {
    return (t, propertyKey) => {
        const key = String(propertyKey)
        const column = ModelRegistry.get(t.constructor)?.columns.find(c => c.propertyKey === key)
        if (column) {
            ModelRegistry.assignRole(t.constructor, key, role)
        } else {
            // fallback when @NamedColumn is not stacked below: register a DATE column
            ModelRegistry.defineColumn(t.constructor, {
                propertyKey: key,
                dataType: { kind: 'date' },
                options: {},
                role,
            })
        }
    }
}

export function CreatedColumn(): PropertyDecorator {
    return timestampRole('createdAt')
}

export function UpdatedColumn(): PropertyDecorator {
    return timestampRole('updatedAt')
}

export function DeletedColumn(): PropertyDecorator {
    return timestampRole('deletedAt')
}

export function ForeignKey(target: () => Function): PropertyDecorator {
    return (t, propertyKey) => {
        const meta = ModelRegistry.get(t.constructor)
        const key = String(propertyKey)
        const column = meta?.columns.find(c => c.propertyKey === key)
        if (column) {
            column.foreignKeyTarget = target
        } else {
            // fallback when @NamedColumn is not stacked below
            ModelRegistry.defineColumn(t.constructor, {
                propertyKey: key,
                dataType: { kind: 'integer' },
                options: {},
                foreignKeyTarget: target,
            })
        }
    }
}
