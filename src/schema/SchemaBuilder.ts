import { relations } from 'drizzle-orm'
import type { Table as TDrizzleTable } from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { TColumnMeta, TTableMeta } from '../types/metadata'
import { ISchemaDialect, TColumnBuilder } from './dialect/ISchemaDialect'
import { PgSchemaDialect } from './dialect/PgSchemaDialect'
import { INamingStrategy } from '../naming/INamingStrategy'

export class SchemaBuilder {
    private static built = false
    private static schema: Record<string, unknown> = {}
    private static dialect: ISchemaDialect = new PgSchemaDialect()
    private static namingStrategy?: INamingStrategy

    static setDialect(dialect: ISchemaDialect): void {
        if (this.built) {
            throw new Error('SchemaBuilder dialect cannot be changed after the schema has been built')
        }
        this.dialect = dialect
    }

    // there is no implicit convention: a column without an explicit name is only
    // resolvable once the application declares how its database names things
    static setNamingStrategy(namingStrategy: INamingStrategy): void {
        if (this.built) {
            throw new Error('SchemaBuilder naming strategy cannot be changed after the schema has been built')
        }
        this.namingStrategy = namingStrategy
    }

    static build(): Record<string, unknown> {
        if (this.built) {
            return this.schema
        }
        const metas = ModelRegistry.all()

        for (const meta of metas) {
            this.resolveColumnNames(meta)
        }

        for (const meta of metas) {
            const table = this.dialect.createTable(meta.tableName, this.buildColumns(meta))
            meta.drizzleTable = table
            this.schema[meta.tableName] = table
            this.installAccessors(meta)
        }

        for (const meta of metas) {
            const relName = `${meta.tableName}Relations`
            this.schema[relName] = this.buildRelations(meta)
        }

        this.built = true
        return this.schema
    }

    static getSchema(): Record<string, unknown> {
        return this.built ? this.schema : this.build()
    }

    static isBuilt(): boolean {
        return this.built
    }

    private static resolveColumnNames(meta: TTableMeta): void {
        for (const col of meta.columns) {
            if (col.columnName) {
                continue
            }
            if (!this.namingStrategy) {
                throw new Error(
                    `Column "${(meta.modelCtor as { name?: string }).name}.${col.propertyKey}" has no explicit column name. `
                    + 'Pass it to @NamedColumn(type, name) or configure SchemaBuilder.setNamingStrategy(...) before the schema is built.',
                )
            }
            col.columnName = this.namingStrategy.columnName(col.propertyKey)
        }
    }

    private static installAccessors(meta: TTableMeta): void {
        const proto = (meta.modelCtor as { prototype: object }).prototype
        for (const col of meta.columns) {
            const key = col.propertyKey
            if (Object.getOwnPropertyDescriptor(proto, key)) {
                continue
            }
            Object.defineProperty(proto, key, {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                get(this: any) {
                    return this.dataValues[key]
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                set(this: any, value: unknown) {
                    if (this.dataValues[key] !== value) {
                        this.dataValues[key] = value
                        this._changed.add(key)
                    }
                },
                enumerable: true,
                configurable: true,
            })
        }
    }

    private static buildColumns(meta: TTableMeta): Record<string, TColumnBuilder> {
        const cols: Record<string, TColumnBuilder> = {}
        for (const col of meta.columns) {
            cols[col.propertyKey] = this.applyColumnModifiers(col, this.dialect.mapColumn(col))
        }
        return cols
    }

    private static applyColumnModifiers(col: TColumnMeta, builder: TColumnBuilder): TColumnBuilder {
        let result = builder
        if (col.options.primaryKey) {
            result = result.primaryKey()
        }
        if (col.options.allowNull === false && !col.options.primaryKey) {
            result = result.notNull()
        }
        if (col.role === 'createdAt') {
            result = result.$defaultFn(() => new Date())
        } else if (col.role === 'updatedAt') {
            result = result.$defaultFn(() => new Date()).$onUpdateFn(() => new Date())
        }
        return result
    }

    private static buildRelations(meta: TTableMeta): unknown {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (relations as any)(meta.drizzleTable as TDrizzleTable, ({ one, many }: any) =>
            this.buildRelationConfig(meta, one, many),
        )
    }

    static buildRelationConfig(
        meta: TTableMeta,
        one: (table: unknown, config?: unknown) => unknown,
        many: (table: unknown) => unknown,
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {}
        for (const rel of meta.relations) {
            const targetCtor = rel.target()
            const targetMeta = ModelRegistry.get(targetCtor)
            if (!targetMeta?.drizzleTable) {
                continue
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const targetTable = targetMeta.drizzleTable as any

            if (rel.kind === 'belongsTo') {
                const fkCol = meta.columns.find(c => c.foreignKeyTarget && c.foreignKeyTarget() === targetCtor)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ownTable = meta.drizzleTable as any
                if (fkCol) {
                    out[rel.propertyKey] = one(targetTable, {
                        fields: [ownTable[fkCol.propertyKey]],
                        references: [targetTable[targetMeta.primaryKey]],
                    })
                } else {
                    out[rel.propertyKey] = one(targetTable)
                }
            } else if (rel.kind === 'hasMany') {
                out[rel.propertyKey] = many(targetTable)
            } else if (rel.kind === 'belongsToMany') {
                // RQB has no one-hop m2m: relate to the junction; DBModelQuery/Hydrator expand it
                const throughCtor = rel.through?.()
                const throughMeta = throughCtor ? ModelRegistry.get(throughCtor) : undefined
                if (throughMeta?.drizzleTable) {
                    out[rel.propertyKey] = many(throughMeta.drizzleTable)
                }
            }
        }
        return out
    }
}
