import { TColumnMeta, TColumnRole, TRelationMeta, TTableMeta, TTableOptions } from '../types/metadata'

export class ModelRegistry {
    private static readonly tables = new Map<Function, TTableMeta>()

    private static ensure(ctor: Function): TTableMeta {
        let meta = this.tables.get(ctor)
        if (!meta) {
            meta = {
                modelCtor: ctor,
                tableName: '',
                paranoid: false,
                primaryKey: 'id',
                columns: [],
                relations: [],
            }
            this.tables.set(ctor, meta)
        }
        return meta
    }

    static defineTable(ctor: Function, tableName: string, opts: TTableOptions = {}): void {
        const meta = this.ensure(ctor)
        meta.tableName = tableName
        meta.paranoid = opts.paranoid ?? false
    }

    static defineColumn(ctor: Function, column: TColumnMeta): void {
        const meta = this.ensure(ctor)
        meta.columns.push(column)
        if (column.options.primaryKey) {
            meta.primaryKey = column.propertyKey
        }
        if (column.role) {
            this.setRoleKey(meta, column.role, column.propertyKey)
        }
    }

    static assignRole(ctor: Function, propertyKey: string, role: TColumnRole): void {
        const meta = this.ensure(ctor)
        const column = meta.columns.find(c => c.propertyKey === propertyKey)
        if (column) {
            column.role = role
        }
        this.setRoleKey(meta, role, propertyKey)
    }

    private static setRoleKey(meta: TTableMeta, role: TColumnRole, propertyKey: string): void {
        if (role === 'createdAt') {
            meta.createdAtKey = propertyKey
        } else if (role === 'updatedAt') {
            meta.updatedAtKey = propertyKey
        } else if (role === 'deletedAt') {
            meta.deletedAtKey = propertyKey
        }
    }

    static defineRelation(ctor: Function, relation: TRelationMeta): void {
        const meta = this.ensure(ctor)
        const existing = meta.relations.find(r => r.propertyKey === relation.propertyKey)
        if (existing) {
            Object.assign(existing, relation)
        } else {
            meta.relations.push(relation)
        }
    }

    static get(ctor: Function): TTableMeta | undefined {
        return this.tables.get(ctor)
    }

    static require(ctor: Function): TTableMeta {
        const meta = this.tables.get(ctor)
        if (!meta) {
            throw new Error(`Model ${ctor?.name ?? ctor} is not registered in ModelRegistry`)
        }
        return meta
    }

    static all(): TTableMeta[] {
        return [...this.tables.values()]
    }
}
