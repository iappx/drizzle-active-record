import { ModelRegistry } from '../registry/ModelRegistry'
import { RelationForeignKey } from '../schema/RelationForeignKey'

export class Hydrator {
    static hydrate<M>(ctor: new () => M, row: Record<string, unknown> | null | undefined): M | null {
        if (row == null) {
            return null
        }
        const meta = ModelRegistry.require(ctor)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = new ctor() as any

        const relationKeys = new Set(meta.relations.map(r => r.propertyKey))
        const columnKeys = new Set(meta.columns.map(c => c.propertyKey))

        for (const col of meta.columns) {
            if (col.propertyKey in row) {
                inst.setDataValue(col.propertyKey, row[col.propertyKey])
            }
        }

        for (const key of Object.keys(row)) {
            if (!columnKeys.has(key) && !relationKeys.has(key)) {
                // computed columns (select extras, aggregates) are reachable both as a plain
                // property and through getDataValue(), the way a real column is
                inst[key] = row[key]
                inst.setDataValue(key, row[key])
            }
        }

        for (const rel of meta.relations) {
            if (!(rel.propertyKey in row)) {
                continue
            }
            const raw = row[rel.propertyKey]
            const RelClass = rel.target() as new () => unknown

            if (rel.kind === 'belongsToMany') {
                // loaded through the junction: raw rows are junction rows, the target sits in a nested key
                const throughMeta = rel.through ? ModelRegistry.get(rel.through()) : undefined
                const targetRelKey = throughMeta
                    ? RelationForeignKey.junctionRelation(throughMeta, RelClass, rel.otherKey)?.propertyKey
                    : undefined
                const junctionRows = Array.isArray(raw) ? raw : []
                inst[rel.propertyKey] = targetRelKey
                    ? junctionRows
                        .map(j => this.hydrate(RelClass, (j as Record<string, unknown>)?.[targetRelKey] as Record<string, unknown>))
                        .filter(Boolean)
                    : []
                continue
            }

            if (raw == null) {
                inst[rel.propertyKey] = raw
            } else if (Array.isArray(raw)) {
                inst[rel.propertyKey] = raw.map(r => this.hydrate(RelClass, r as Record<string, unknown>))
            } else {
                inst[rel.propertyKey] = this.hydrate(RelClass, raw as Record<string, unknown>)
            }
        }

        inst._changed.clear()
        return inst as M
    }

    static hydrateMany<M>(ctor: new () => M, rows: Record<string, unknown>[]): M[] {
        return rows.map(r => this.hydrate(ctor, r) as M)
    }
}
