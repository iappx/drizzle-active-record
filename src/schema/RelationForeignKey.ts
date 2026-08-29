import { eq, SQL } from 'drizzle-orm'
import { TColumnMeta, TRelationMeta, TTableMeta } from '../types/metadata'

/** Where {@link RelationForeignKey.resolve} looks for the column carrying a relation's foreign key. */
export type TForeignKeyLookup = {
    /** model the foreign key column lives on */
    ownerMeta: TTableMeta
    /** model the foreign key points at */
    referencedCtor: Function
    /** model that declares the relation — used for error messages only */
    declaringMeta: TTableMeta
    rel: TRelationMeta
    /** defaults to `rel.foreignKey`; pass `rel.otherKey` for the target side of a m2m */
    explicitKey?: string
    /** name of the relation option the explicit key came from, for error messages */
    optionName?: string
}

/** Where {@link RelationForeignKey.resolveReferencedKey} looks for the column a foreign key points at. */
export type TReferencedKeyLookup = {
    /** model the column on the far side of the join lives on */
    ownerMeta: TTableMeta
    /** model that declares the relation — used for error messages only */
    declaringMeta: TTableMeta
    rel: TRelationMeta
    /** defaults to the option matching the relation kind; pass one explicitly for a m2m hop */
    explicitKey?: string
    /** name of the relation option the explicit key came from, for error messages */
    optionName?: string
}

/**
 * Resolves which column carries the foreign key of a relation.
 *
 * Without an explicit key the single column referencing the other model is used. Two or more such
 * columns (`sourceWalletTypeId` / `targetWalletTypeId`, `parentId` / `sponsorId`, ...) are
 * ambiguous, and fail when the schema is built.
 */
export class RelationForeignKey {
    /** Strict lookup: throws on an unknown key and on an unresolvable ambiguity. */
    public static resolve(lookup: TForeignKeyLookup): TColumnMeta | undefined {
        const { ownerMeta, referencedCtor, declaringMeta, rel } = lookup
        const optionName = lookup.optionName ?? 'foreignKey'
        const explicitKey = 'explicitKey' in lookup ? lookup.explicitKey : rel.foreignKey

        if (explicitKey) {
            const column = this.byKey(ownerMeta, explicitKey)
            if (!column) {
                throw new Error(
                    `Relation "${this.label(declaringMeta, rel)}" declares { ${optionName}: '${explicitKey}' }, `
                    + `but model ${this.modelName(ownerMeta)} has no such column. Expected the property key of a `
                    + `column on ${this.modelName(ownerMeta)} (its database column name is accepted too).`,
                )
            }
            return column
        }

        const candidates = this.candidates(ownerMeta, referencedCtor)
        if (candidates.length > 1) {
            const keys = candidates.map(c => `'${c.propertyKey}'`).join(', ')
            throw new Error(
                `Relation "${this.label(declaringMeta, rel)}" is ambiguous: model ${this.modelName(ownerMeta)} has `
                + `${candidates.length} columns referencing ${this.modelName(referencedCtor)} (${keys}). `
                + `Add { ${optionName}: '<propertyKey>' } to the relation to say which one it uses.`,
            )
        }
        return candidates[0]
    }

    /**
     * The property key on the *other* side of the join — the column the foreign key points at.
     *
     * Without `targetKey` / `sourceKey` this is the primary key of that model. Naming a plain column
     * instead is how a relation joins on shared field values (every row with the same `accountId`)
     * or on a natural key (`guid`).
     *
     * Strict: an unknown key fails when the schema is built.
     */
    public static resolveReferencedKey(lookup: TReferencedKeyLookup): string {
        const { ownerMeta, declaringMeta, rel } = lookup
        const explicitKey = 'explicitKey' in lookup ? lookup.explicitKey : this.referencedKeyOf(rel)
        if (!explicitKey) {
            return ownerMeta.primaryKey
        }
        const optionName = lookup.optionName ?? this.referencedOptionName(rel)
        const column = this.byKey(ownerMeta, explicitKey)
        if (!column) {
            throw new Error(
                `Relation "${this.label(declaringMeta, rel)}" declares { ${optionName}: '${explicitKey}' }, `
                + `but model ${this.modelName(ownerMeta)} has no such column. Expected the property key of a `
                + `column on ${this.modelName(ownerMeta)} (its database column name is accepted too).`,
            )
        }
        return column.propertyKey
    }

    /** Lenient counterpart of {@link resolveReferencedKey}: falls back to the primary key. */
    public static findReferencedKey(ownerMeta: TTableMeta, rel: TRelationMeta): string {
        const explicitKey = this.referencedKeyOf(rel)
        return (explicitKey ? this.byKey(ownerMeta, explicitKey)?.propertyKey : undefined) ?? ownerMeta.primaryKey
    }

    private static referencedOptionName(rel: TRelationMeta): string {
        return rel.kind === 'belongsTo' ? 'targetKey' : 'sourceKey'
    }

    private static referencedKeyOf(rel: TRelationMeta): string | undefined {
        return rel.kind === 'belongsTo' ? rel.targetKey : rel.sourceKey
    }

    /** Lenient lookup: returns undefined instead of throwing. */
    public static find(ownerMeta: TTableMeta, referencedCtor: Function, explicitKey?: string): TColumnMeta | undefined {
        if (explicitKey) {
            return this.byKey(ownerMeta, explicitKey)
        }
        return this.candidates(ownerMeta, referencedCtor)[0]
    }

    /**
     * The `eq(...)` condition correlating a child row to its parent along a relation.
     *
     * The tables are taken as given — real, a recursive twin, or aliased — and only which side
     * carries the foreign key follows the relation kind. Returns `undefined` when the relation has
     * no resolvable foreign key column, exactly like {@link find}.
     */
    public static linkCondition(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parentTable: any,
        parentMeta: TTableMeta,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        childTable: any,
        childMeta: TTableMeta,
        rel: TRelationMeta,
    ): SQL | undefined {
        if (rel.kind === 'hasMany' || rel.kind === 'belongsToMany') {
            // the foreign key lives on the child and points back at the parent
            const fkCol = this.find(childMeta, parentMeta.modelCtor, rel.foreignKey)
            return fkCol ? eq(childTable[fkCol.propertyKey], parentTable[this.findReferencedKey(parentMeta, rel)]) : undefined
        }
        const fkCol = this.find(parentMeta, childMeta.modelCtor, rel.foreignKey)
        return fkCol ? eq(childTable[this.findReferencedKey(childMeta, rel)], parentTable[fkCol.propertyKey]) : undefined
    }

    /**
     * The junction relation carrying the *target* half of a belongsToMany. Without `otherKey`
     * the first relation to the target wins, which is only ever wrong when the junction
     * references the same model twice — the case `otherKey` exists for.
     */
    public static junctionRelation(
        throughMeta: TTableMeta,
        targetCtor: Function,
        otherKey?: string,
    ): TRelationMeta | undefined {
        const candidates = throughMeta.relations.filter(r => r.target() === targetCtor)
        if (!otherKey) {
            return candidates[0]
        }
        return candidates.find(r => this.matches(this.find(throughMeta, targetCtor, r.foreignKey), otherKey))
    }

    /** Does `column` answer to `key`, given as a property key or as a database column name? */
    public static matches(column: TColumnMeta | undefined, key: string): boolean {
        return !!column && (column.propertyKey === key || column.columnName === key)
    }

    private static byKey(ownerMeta: TTableMeta, key: string): TColumnMeta | undefined {
        return ownerMeta.columns.find(c => this.matches(c, key))
    }

    private static candidates(ownerMeta: TTableMeta, referencedCtor: Function): TColumnMeta[] {
        return ownerMeta.columns.filter(c => c.foreignKeyTargets?.some(target => target() === referencedCtor))
    }

    private static label(meta: TTableMeta, rel: TRelationMeta): string {
        return `${this.modelName(meta)}.${rel.propertyKey}`
    }

    private static modelName(source: TTableMeta | Function): string {
        const ctor = typeof source === 'function' ? source : source.modelCtor
        return (ctor as { name?: string }).name ?? (source as TTableMeta).tableName
    }
}
