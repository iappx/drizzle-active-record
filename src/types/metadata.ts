import type { Table as TDrizzleTable } from 'drizzle-orm'
import type { PgBigIntConfig, PgNumericConfig } from 'drizzle-orm/pg-core'

export type TDbDataTypeKind =
    | 'integer'
    | 'smallint'
    | 'bigint'
    | 'string'
    | 'text'
    | 'date'
    | 'time'
    | 'boolean'
    | 'float'
    | 'double'
    | 'decimal'
    | 'uuid'
    | 'json'
    | 'jsonb'
    | 'enum'
    | 'array'
    | 'custom'

// how the driver hands a value back to the application. Taken from drizzle rather than
// restated, so the accepted modes track the underlying column builders
export type TDecimalMode = NonNullable<PgNumericConfig['mode']>
export type TBigIntMode = PgBigIntConfig['mode']

export type TDbDataType = {
    kind: TDbDataTypeKind
    enumValues?: string[]
    // STRING(64). Deliberately not named `length`: the sized types double as factory
    // functions, and a function's own `length` is its arity — it would shadow this field
    size?: number
    // DECIMAL(precision, scale)
    precision?: number
    scale?: number
    // DECIMAL(15, 4, { mode: 'string' }) / BIGINT({ mode: 'bigint' }) — how the value is read back.
    // Left undefined the dialect keeps its default, so existing models are unaffected
    mode?: TDecimalMode
    // ARRAY(itemType)
    itemType?: TDbDataType
    // CUSTOM('ltree') — a database type the dialect has no dedicated builder for
    sqlType?: string
}

export type TModelIdentifier = number | string

export type TColumnOptions = {
    primaryKey?: boolean
    autoIncrement?: boolean
    allowNull?: boolean
    defaultValue?: unknown
}

export type TColumnRole = 'createdAt' | 'updatedAt' | 'deletedAt'

export type TColumnMeta = {
    propertyKey: string
    // undefined until SchemaBuilder resolves it through the configured naming strategy
    columnName?: string
    dataType: TDbDataType
    options: TColumnOptions
    foreignKeyTarget?: () => Function
    role?: TColumnRole
}

export type TRelationKind = 'belongsTo' | 'hasMany' | 'belongsToMany'

export type TRelationOptions = {
    /**
     * Property key of the column carrying the foreign key (its database column name is
     * accepted too). Which model the column lives on depends on the relation:
     *   belongsTo / hasOne — the declaring model;
     *   hasMany            — the target model;
     *   belongsToMany      — the junction model, pointing back at the declaring model.
     * Left out, the single column referencing the other model is used; more than one and
     * the schema build fails rather than picking one at random.
     */
    foreignKey?: string
    /**
     * belongsTo / hasOne: property key of the column on the *target* model the foreign key
     * points at (its database column name is accepted too). Left out, the target's primary
     * key is used — joining on a plain column is what this option is for.
     */
    targetKey?: string
    /**
     * hasMany / belongsToMany: property key of the column on the *declaring* model the
     * foreign key points back at (its database column name is accepted too). Left out, the
     * declaring model's primary key is used.
     */
    sourceKey?: string
    /**
     * belongsToMany only: property key of the junction column pointing at the *target*
     * model. Needed when the junction references the same model twice.
     */
    otherKey?: string
}

export type TRelationMeta = TRelationOptions & {
    propertyKey: string
    kind: TRelationKind
    target: () => Function
    through?: () => Function
}

export type TTableOptions = {
    paranoid?: boolean
}

export type TTableMeta = {
    modelCtor: Function
    tableName: string
    paranoid: boolean
    primaryKey: string
    columns: TColumnMeta[]
    relations: TRelationMeta[]
    createdAtKey?: string
    updatedAtKey?: string
    deletedAtKey?: string
    drizzleTable?: TDrizzleTable
    // twin table standing in for the CTE of a recursive query over this model
    recursiveTable?: TDrizzleTable
}
