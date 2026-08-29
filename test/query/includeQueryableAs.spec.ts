import { Orm, SchemaBuilder } from '../../src'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { Person, TransferRule, WalletType } from '../fixtures/multiRefModels'

// A real drizzle instance so the join is rendered by drizzle itself: the generated statement is
// the only proof that the include resolved to the relation `as` names. The pool never connects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any

beforeAll(() => {
    db = drizzle(new Pool({ host: 'localhost' }), { schema: SchemaBuilder.build() })
})

beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(Orm, 'conn').mockReturnValue(db)
})

describe('includeQueryable — { as } disambiguates two relations to the same model', () => {
    const sqlFor = (as: string): string =>
        TransferRule.query().includeQueryable(WalletType.query(), { as }).toSQL().sql

    it('belongsTo: each relation joins through its own column', () => {
        expect(sqlFor('sourceWalletType')).toContain('"id" = "transfer_rules"."source_wallet_type_id"')
        expect(sqlFor('targetWalletType')).toContain('"id" = "transfer_rules"."target_wallet_type_id"')
    })

    it('belongsTo: neither relation borrows the column of the other', () => {
        expect(sqlFor('sourceWalletType')).not.toContain('= "transfer_rules"."target_wallet_type_id"')
        expect(sqlFor('targetWalletType')).not.toContain('= "transfer_rules"."source_wallet_type_id"')
    })

    it('hasMany: joins on the column the named relation uses', () => {
        const outgoing = WalletType.query().includeQueryable(TransferRule.query(), { as: 'outgoingRules' }).toSQL().sql
        const incoming = WalletType.query().includeQueryable(TransferRule.query(), { as: 'incomingRules' }).toSQL().sql
        expect(outgoing).toContain('"source_wallet_type_id" = "wallet_types"."id"')
        expect(outgoing).not.toContain('"target_wallet_type_id" = "wallet_types"."id"')
        expect(incoming).toContain('"target_wallet_type_id" = "wallet_types"."id"')
        expect(incoming).not.toContain('"source_wallet_type_id" = "wallet_types"."id"')
    })

    it('resolves a self-reference through the named column', () => {
        const parent = Person.query().includeQueryable(Person.query(), { as: 'parent' }).toSQL().sql
        const sponsor = Person.query().includeQueryable(Person.query(), { as: 'sponsor' }).toSQL().sql
        expect(parent).toContain('"id" = "people"."parent_id"')
        expect(sponsor).toContain('"id" = "people"."sponsor_id"')
    })

    it('without { as } the first declared relation still wins — the reason { as } exists', () => {
        const implicit = TransferRule.query().includeQueryable(WalletType.query()).toSQL().sql
        expect(implicit).toBe(sqlFor('sourceWalletType'))
    })

    it('an { as } naming no relation fails instead of building a bogus branch', () => {
        expect(() => TransferRule.query().includeQueryable(WalletType.query(), { as: 'nope' }))
            .toThrow(/No relation "nope"/)
    })

    it('{ required: true } builds the EXISTS on the relation { as } names', () => {
        const statement = WalletType.query()
            .includeQueryable(TransferRule.query(), { as: 'incomingRules', required: true })
            .toSQL().sql
        expect(statement).toContain('exists')
        expect(statement).toContain('"target_wallet_type_id" = "wallet_types"."id"')
    })
})
