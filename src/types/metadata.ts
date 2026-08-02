import type { Table as TDrizzleTable } from 'drizzle-orm'

export type TDbDataTypeKind =
    | 'integer'
    | 'bigint'
    | 'string'
    | 'text'
    | 'date'
    | 'boolean'
    | 'float'
    | 'json'
    | 'jsonb'
    | 'enum'

export type TDbDataType = {
    kind: TDbDataTypeKind
    enumValues?: string[]
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

export type TRelationMeta = {
    propertyKey: string
    kind: TRelationKind
    target: () => Function
    foreignKey?: string
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
}
