import type { Table as TDrizzleTable } from 'drizzle-orm'
import type { PgBigIntConfig, PgNumericConfig } from 'drizzle-orm/pg-core'

/** The family a column type belongs to, as declared through `DataType`. */
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

/** How the driver hands a `numeric` value back to the application. */
export type TDecimalMode = NonNullable<PgNumericConfig['mode']>

/** How the driver hands a `bigint` value back to the application. */
export type TBigIntMode = PgBigIntConfig['mode']

/**
 * A column type as declared on a model, before the dialect turns it into a database type.
 *
 * Every field beyond `kind` belongs to one kind only, and the ones that do not apply are left out.
 */
export type TDbDataType = {
    /** The family this type belongs to; it decides which of the other fields are read. */
    kind: TDbDataTypeKind

    /** The values an `ENUM` column accepts. */
    enumValues?: string[]

    // not named `length`: a sized type is also a function, and a function's `length` is its arity
    size?: number

    precision?: number
    scale?: number

    /** How the value of a `DECIMAL` or `BIGINT` column is read back; the dialect's default applies without it. */
    mode?: TDecimalMode

    itemType?: TDbDataType

    /** The database type of a `CUSTOM` column, written exactly as the server spells it. */
    sqlType?: string
}

/** The value of a primary key, as accepted by lookups by identifier. */
export type TModelIdentifier = number | string

/** Constraints and defaults a column is declared with. */
export type TColumnOptions = {
    primaryKey?: boolean

    /** Leaves the column out of an `INSERT` when no value is set, so the database assigns one. */
    autoIncrement?: boolean

    allowNull?: boolean
    defaultValue?: unknown
}

/** The lifecycle timestamp a column stands for. */
export type TColumnRole = 'createdAt' | 'updatedAt' | 'deletedAt'

/** Everything the registry knows about one column of a model. */
export type TColumnMeta = {
    /** Name of the property carrying this column on the model class. */
    propertyKey: string

    /** Undefined until `SchemaBuilder` resolves it through the configured naming strategy. */
    columnName?: string

    dataType: TDbDataType
    options: TColumnOptions

    /** Every model this column is declared a foreign key to — one `@ForeignKey` decorator each. */
    foreignKeyTargets?: (() => Function)[]

    role?: TColumnRole
}

/** The shape of a relation between two models. */
export type TRelationKind = 'belongsTo' | 'hasMany' | 'belongsToMany'

/** Which columns a relation joins on, where the defaults are not what the model needs. */
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

/** Everything the registry knows about one relation of a model. */
export type TRelationMeta = TRelationOptions & {
    /** Name of the property carrying the related model or models. */
    propertyKey: string

    kind: TRelationKind

    /** The model on the other end, wrapped in a thunk so the two files may import each other. */
    target: () => Function

    /** `belongsToMany` only: the junction model the relation walks through. */
    through?: () => Function
}

/** Options a model is declared with. */
export type TTableOptions = {
    /** Soft-deletes rows by stamping the `@DeletedColumn`, and hides them from every query. */
    paranoid?: boolean
}

/** Everything the registry knows about one model. */
export type TTableMeta = {
    /** The decorated model class itself. */
    modelCtor: Function

    /** Database table name, exactly as `@Table` spelled it. */
    tableName: string

    paranoid: boolean

    /** Property key of the primary key column; `id` until a column declares itself the key. */
    primaryKey: string

    columns: TColumnMeta[]
    relations: TRelationMeta[]

    /** Property key of the column stamped when a row is created. */
    createdAtKey?: string

    /** Property key of the column stamped when a row is updated. */
    updatedAtKey?: string

    /** Property key of the column stamped when a row is soft-deleted. */
    deletedAtKey?: string

    /** The drizzle table built for this model; undefined until `SchemaBuilder.build()` has run. */
    drizzleTable?: TDrizzleTable

    /** Twin table standing in for the CTE of a recursive query over this model. */
    recursiveTable?: TDrizzleTable
}
