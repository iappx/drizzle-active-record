import { relations } from 'drizzle-orm'
import type { Table as TDrizzleTable } from 'drizzle-orm'
import { ModelRegistry } from '../registry/ModelRegistry'
import { TColumnMeta, TRelationMeta, TTableMeta } from '../types/metadata'
import { ISchemaDialect, TColumnBuilder } from './dialect/ISchemaDialect'
import { PgSchemaDialect } from './dialect/PgSchemaDialect'
import { RelationForeignKey } from './RelationForeignKey'
import { INamingStrategy } from '../naming/INamingStrategy'

/**
 * Turns the registered models into the drizzle schema the ORM runs on.
 *
 * The schema is built once, at application start, after every model file has been imported: column
 * names are resolved, one drizzle table and one recursive twin are created per model, accessors are
 * installed on the model prototypes, and every relation's join columns are resolved. The dialect and
 * the naming strategy are installed before that; afterwards they are fixed.
 *
 * @example
 * ```ts
 * import './models'
 *
 * SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
 * const db = drizzle(pool, { schema: SchemaBuilder.build() })
 * ```
 */
export class SchemaBuilder {
    /** Suffix of the twin table a recursive query targets. */
    public static readonly RecursiveSuffix = '__recursive'

    /** Prefix of the internal back-references generated for relations with an explicit foreign key. */
    public static readonly ForeignKeyPrefix = '__foreignKey'

    private static built = false
    private static schema: Record<string, unknown> = {}
    private static dialect: ISchemaDialect = new PgSchemaDialect()
    private static namingStrategy?: INamingStrategy

    /**
     * Installs the schema dialect the tables and columns are built with.
     *
     * Defaults to {@link PgSchemaDialect}. Call it before {@link SchemaBuilder.build}.
     *
     * @throws {Error} When the schema has already been built
     *
     * @example
     * ```ts
     * SchemaBuilder.setDialect(new PgSchemaDialect())
     * SchemaBuilder.build()
     * ```
     */
    static setDialect(dialect: ISchemaDialect): void {
        if (this.built) {
            throw new Error('SchemaBuilder dialect cannot be changed after the schema has been built')
        }
        this.dialect = dialect
    }

    /**
     * Installs the strategy that derives a database column name from a property key.
     *
     * There is no default: a column declared without an explicit name is unresolvable until a
     * strategy is installed, and {@link SchemaBuilder.build} throws naming it. Call it before
     * building the schema.
     *
     * @throws {Error} When the schema has already been built
     *
     * @example
     * ```ts
     * SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy()) // firstName -> first_name
     * SchemaBuilder.build()
     * ```
     */
    static setNamingStrategy(namingStrategy: INamingStrategy): void {
        if (this.built) {
            throw new Error('SchemaBuilder naming strategy cannot be changed after the schema has been built')
        }
        this.namingStrategy = namingStrategy
    }

    /**
     * Builds the drizzle schema from every registered model and returns it.
     *
     * Idempotent: the second call returns the schema built by the first. The keys are the table
     * names, each model's recursive twin, and a `<tableName>Relations` config per table.
     *
     * @returns The schema object to hand to `drizzle(pool, { schema })`
     * @throws {Error} When a column has no name and no naming strategy is installed, or when a
     * relation cannot resolve exactly one join column
     *
     * @example
     * ```ts
     * SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
     * const db = drizzle(new Pool({ host: 'localhost' }), { schema: SchemaBuilder.build() })
     * ```
     */
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

            // A twin of the table, named after the CTE a recursive query defines. It is never a real
            // table: the CTE shadows it, which is what lets a recursive query use the relational
            // query builder — and therefore relations — like any other query.
            const recursiveName = this.recursiveTableName(meta)
            const recursiveTable = this.dialect.createTable(recursiveName, this.buildColumns(meta))
            meta.recursiveTable = recursiveTable
            this.schema[recursiveName] = recursiveTable
        }

        // drizzle only calls a relations config when a connection is opened over the schema, so
        // every foreign key is resolved once here as well: a relation that cannot pick a column
        // has to fail while the schema is built, not on the first query that reads it
        for (const meta of metas) {
            this.validateRelations(meta)
        }

        for (const meta of metas) {
            this.schema[`${meta.tableName}Relations`] = this.buildRelations(meta, false)
            this.schema[`${this.recursiveTableName(meta)}Relations`] = this.buildRelations(meta, true)
        }

        this.built = true
        return this.schema
    }

    /** The built schema, building it first if that has not happened yet. */
    static getSchema(): Record<string, unknown> {
        return this.built ? this.schema : this.build()
    }

    /** Whether the schema has been built, and the dialect and naming strategy are therefore fixed. */
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
            this.defineAccessor(proto, col.propertyKey, true, col.propertyKey === meta.primaryKey)
        }
        // A loaded relation lives in `dataValues` too, so `dataValues` / `getDataValue()` hold the
        // whole loaded row — columns, computed extras and relations alike. Consumers that read a
        // model through that bag (the Sequelize contract this layer reproduces) would otherwise see
        // every included relation as `undefined` while it sits on the instance.
        for (const rel of meta.relations) {
            this.defineAccessor(proto, rel.propertyKey, false)
        }
    }

    // without the primary key no-op, `update({ id: 'other' })` builds `UPDATE … SET id = 'other'
    // WHERE id = 'other'` — the WHERE is read after the assignment — and silently matches no row
    private static defineAccessor(proto: object, key: string, track: boolean, isPrimaryKey = false): void {
        if (Object.getOwnPropertyDescriptor(proto, key)) {
            return
        }
        Object.defineProperty(proto, key, {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            get(this: any) {
                return this.dataValues[key]
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            set(this: any, value: unknown) {
                if (isPrimaryKey && this.dataValues[key] != null) {
                    return
                }
                if (this.dataValues[key] !== value) {
                    this.dataValues[key] = value
                    if (track) {
                        this._changed.add(key)
                    }
                }
            },
            enumerable: true,
            configurable: true,
        })
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

    /** Name of the CTE a recursive query over this model defines, and of its twin table. */
    static recursiveTableName(meta: TTableMeta): string {
        return `${meta.tableName}${SchemaBuilder.RecursiveSuffix}`
    }

    private static buildRelations(meta: TTableMeta, recursive: boolean): unknown {
        const ownTable = (recursive ? meta.recursiveTable : meta.drizzleTable) as TDrizzleTable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (relations as any)(ownTable, ({ one, many }: any) => ({
            ...this.buildRelationConfig(meta, one, many, recursive),
            // a twin's `many` cannot be inferred — the target knows nothing about it — so the
            // real table carries the other half of the pair
            ...(recursive ? {} : this.buildRecursiveBackRefs(meta, one)),
            ...(recursive ? {} : this.buildExplicitFkBackRefs(meta, one)),
        }))
    }

    /**
     * Builds the drizzle relations config for one model, keyed by relation property key.
     *
     * A `belongsTo` becomes a `one`, a `hasMany` a `many`, and a `belongsToMany` a `many` onto its
     * junction table. Relations whose target or junction is not registered are skipped. With
     * `recursive`, the config hangs off the model's recursive twin instead of its real table.
     *
     * @param one Drizzle's `one` builder, as handed to a `relations(...)` callback
     * @param many Drizzle's `many` builder, as handed to a `relations(...)` callback
     *
     * @example
     * ```ts
     * const config = relations(Author.meta.drizzleTable, ({ one, many }) =>
     *     SchemaBuilder.buildRelationConfig(Author.meta, one, many))
     * ```
     */
    static buildRelationConfig(
        meta: TTableMeta,
        one: (table: unknown, config?: unknown) => unknown,
        many: (table: unknown, config?: unknown) => unknown,
        recursive = false,
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {}
        // relations always point at the real tables: only the side they hang off differs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ownTable = (recursive ? meta.recursiveTable : meta.drizzleTable) as any
        for (const rel of meta.relations) {
            const targetCtor = rel.target()
            const targetMeta = ModelRegistry.get(targetCtor)
            if (!targetMeta?.drizzleTable) {
                continue
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const targetTable = targetMeta.drizzleTable as any
            const pairing = recursive ? { relationName: this.recursiveRelationName(meta, rel) } : undefined

            if (rel.kind === 'belongsTo') {
                const fkCol = this.relationForeignKey(meta, rel)
                if (fkCol) {
                    out[rel.propertyKey] = one(targetTable, {
                        fields: [ownTable[fkCol.propertyKey]],
                        references: [targetTable[this.relationReferencedKey(meta, targetMeta, rel)]],
                    })
                } else {
                    out[rel.propertyKey] = one(targetTable)
                }
            } else if (rel.kind === 'hasMany') {
                out[rel.propertyKey] = many(targetTable, pairing ?? this.explicitFkPairing(meta, rel))
            } else if (rel.kind === 'belongsToMany') {
                // RQB has no one-hop m2m: relate to the junction; DBModelQuery/Hydrator expand it
                const throughCtor = rel.through?.()
                const throughMeta = throughCtor ? ModelRegistry.get(throughCtor) : undefined
                if (throughMeta?.drizzleTable) {
                    out[rel.propertyKey] = many(throughMeta.drizzleTable, pairing ?? this.explicitFkPairing(meta, rel))
                }
            }
        }
        return out
    }

    private static validateRelations(meta: TTableMeta): void {
        for (const rel of meta.relations) {
            this.relationForeignKey(meta, rel)
            // the far side of the join: an unknown { targetKey } / { sourceKey } fails here too
            const targetMeta = ModelRegistry.get(rel.target())
            if (targetMeta) {
                this.relationReferencedKey(meta, targetMeta, rel)
            }
            if (rel.kind !== 'belongsToMany') {
                continue
            }
            const throughCtor = rel.through?.()
            const throughMeta = throughCtor ? ModelRegistry.get(throughCtor) : undefined
            if (throughMeta) {
                RelationForeignKey.resolve({
                    ownerMeta: throughMeta,
                    referencedCtor: rel.target(),
                    declaringMeta: meta,
                    rel,
                    explicitKey: rel.otherKey,
                    optionName: 'otherKey',
                })
            }
        }
    }

    private static relationForeignKey(meta: TTableMeta, rel: TRelationMeta): TColumnMeta | undefined {
        const targetMeta = ModelRegistry.get(rel.target())
        if (!targetMeta) {
            return undefined
        }
        if (rel.kind === 'belongsTo') {
            return RelationForeignKey.resolve({
                ownerMeta: meta,
                referencedCtor: rel.target(),
                declaringMeta: meta,
                rel,
            })
        }
        if (rel.kind === 'hasMany') {
            return RelationForeignKey.resolve({
                ownerMeta: targetMeta,
                referencedCtor: meta.modelCtor,
                declaringMeta: meta,
                rel,
            })
        }
        const throughCtor = rel.through?.()
        const throughMeta = throughCtor ? ModelRegistry.get(throughCtor) : undefined
        if (!throughMeta) {
            return undefined
        }
        return RelationForeignKey.resolve({
            ownerMeta: throughMeta,
            referencedCtor: meta.modelCtor,
            declaringMeta: meta,
            rel,
        })
    }

    private static relationReferencedKey(meta: TTableMeta, targetMeta: TTableMeta, rel: TRelationMeta): string {
        return RelationForeignKey.resolveReferencedKey({
            ownerMeta: rel.kind === 'belongsTo' ? targetMeta : meta,
            declaringMeta: meta,
            rel,
        })
    }

    // drizzle picks the `one` behind a `many` by table, which is what an explicit foreignKey or
    // sourceKey overrides; the relation name ties it to the back-reference instead
    private static explicitFkPairing(meta: TTableMeta, rel: TRelationMeta): { relationName: string } | undefined {
        return rel.foreignKey || rel.sourceKey ? { relationName: this.explicitFkRelationName(meta, rel) } : undefined
    }

    private static explicitFkRelationName(meta: TTableMeta, rel: TRelationMeta): string {
        return `${SchemaBuilder.ForeignKeyPrefix}:${meta.tableName}.${rel.propertyKey}`
    }

    // the extra keys are internal and never queried
    private static buildExplicitFkBackRefs(
        meta: TTableMeta,
        one: (table: unknown, config?: unknown) => unknown,
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ownTable = meta.drizzleTable as any
        for (const { parent, rel } of this.manySideSources(meta)) {
            if ((!rel.foreignKey && !rel.sourceKey) || !parent.drizzleTable) {
                continue
            }
            const fkCol = RelationForeignKey.resolve({
                ownerMeta: meta,
                referencedCtor: parent.modelCtor,
                declaringMeta: parent,
                rel,
            })
            if (!fkCol) {
                continue
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parentTable = parent.drizzleTable as any
            out[`${SchemaBuilder.ForeignKeyPrefix}_${parent.tableName}_${rel.propertyKey}`] = one(parentTable, {
                fields: [ownTable[fkCol.propertyKey]],
                references: [parentTable[this.relationReferencedKey(parent, parent, rel)]],
                relationName: this.explicitFkRelationName(parent, rel),
            })
        }
        return out
    }

    // drizzle infers a `many` from the `one` pointing back at it, and nothing points back at a
    // recursive twin; the extra keys are internal and never queried
    private static buildRecursiveBackRefs(
        meta: TTableMeta,
        one: (table: unknown, config?: unknown) => unknown,
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ownTable = meta.drizzleTable as any
        for (const { parent, rel } of this.manySideSources(meta)) {
            const fkCol = RelationForeignKey.resolve({
                ownerMeta: meta,
                referencedCtor: parent.modelCtor,
                declaringMeta: parent,
                rel,
            })
            if (!fkCol || !parent.recursiveTable) {
                continue
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parentTwin = parent.recursiveTable as any
            out[`${SchemaBuilder.RecursiveSuffix}_${parent.tableName}_${rel.propertyKey}`] = one(parentTwin, {
                fields: [ownTable[fkCol.propertyKey]],
                // the twin carries the same columns, so the source key resolves against it unchanged
                references: [parentTwin[this.relationReferencedKey(parent, parent, rel)]],
                relationName: this.recursiveRelationName(parent, rel),
            })
        }
        return out
    }

    private static manySideSources(meta: TTableMeta): { parent: TTableMeta; rel: TRelationMeta }[] {
        const out: { parent: TTableMeta; rel: TRelationMeta }[] = []
        for (const parent of ModelRegistry.all()) {
            for (const rel of parent.relations) {
                const manySide = rel.kind === 'hasMany'
                    ? rel.target()
                    : rel.kind === 'belongsToMany' ? rel.through?.() : undefined
                if (manySide && manySide === meta.modelCtor) {
                    out.push({ parent, rel })
                }
            }
        }
        return out
    }

    private static recursiveRelationName(meta: TTableMeta, rel: TRelationMeta): string {
        return `${SchemaBuilder.RecursiveSuffix}:${meta.tableName}.${rel.propertyKey}`
    }
}
