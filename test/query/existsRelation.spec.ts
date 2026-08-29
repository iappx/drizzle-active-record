import { Op, Orm, SchemaBuilder, SnakeCaseNamingStrategy, SqlConditions, sql } from '../../src'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { Author, Book } from '../fixtures/testModels'
import { Person, WalletType } from '../fixtures/multiRefModels'

// Real drizzle so the condition is rendered end to end — an EXISTS handed back to the caller only
// counts if it survives into the emitted statement with its parameters intact. The pool never connects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    db = drizzle(new Pool({ host: 'localhost' }), { schema: SchemaBuilder.build() })
})

beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(Orm, 'conn').mockReturnValue(db)
})

describe('existsRelation — the required-include EXISTS as a standalone condition', () => {
    it('correlates the related table to the parent row', () => {
        const query = Author.query()
        const statement = query.where(query.existsRelation(Book)).toSQL().sql
        expect(statement).toContain('exists')
        expect(statement).toContain('"books"."author_id" = "authors"."id"')
    })

    it('renders the same condition a required include produces', () => {
        // parameter numbering differs — the required include also loads the relation branch, and
        // that branch binds its own copy of the condition first
        const anyPlaceholder = (statement: string): string => statement.slice(statement.indexOf('exists')).replace(/\$\d+/g, '$?')
        const query = Author.query()
        const standalone = query.where(query.existsRelation({ model: Book, where: { title: 'X' } })).toSQL()
        const included = Author.query().include({ model: Book, where: { title: 'X' }, required: true }).toSQL()
        expect(anyPlaceholder(standalone.sql)).toBe(anyPlaceholder(included.sql))
    })

    it('keeps the child conditions as bound parameters', () => {
        const query = Author.query()
        const { sql: statement, params } = query.where(query.existsRelation({ model: Book, where: { title: 'Dune' } })).toSQL()
        expect(statement).toContain('"books"."title" = $1')
        expect(params).toContain('Dune')
    })

    it('accepts a raw SQL fragment as the child condition', () => {
        const query = Author.query()
        const statement = query
            .where(query.existsRelation({ model: Book, where: sql`${Book.column('rating')} > 4` }))
            .toSQL().sql
        expect(statement).toContain('"books"."rating" > 4')
    })

    it('turns an empty IN list into a condition that matches nothing, not a syntax error', () => {
        const query = Author.query()
        const statement = query.where(query.existsRelation({ model: Book, where: { id: [] } })).toSQL().sql
        expect(statement).toContain('false')
        expect(statement).not.toContain('in ()')
    })

    it('combines with other conditions through OR — the reason it is not just a required include', () => {
        const query = Author.query()
        const condition = SqlConditions.anyOf([
            query.existsRelation(Book),
            Op.is(true).build(query.column('active')),
        ]) as never
        const statement = query.where(condition).toSQL().sql
        expect(statement).toMatch(/exists[\s\S]*or "authors"\."active" is true/)
    })

    it('follows { as } when the model has two relations to the same target', () => {
        const query = WalletType.query()
        const statement = query.where(query.existsRelation({ as: 'incomingRules' })).toSQL().sql
        expect(statement).toContain('"transfer_rules"."target_wallet_type_id" = "wallet_types"."id"')
        expect(statement).not.toContain('source_wallet_type_id')
    })

    it('aliases the child of a self-referencing relation so the correlation is not row = itself', () => {
        const query = Person.query()
        const statement = query
            .where(query.existsRelation({ as: 'children', where: sql`length(${Person.column('name')}) > 3` }))
            .toSQL().sql
        expect(statement).toContain('"people__exists"."parent_id" = "people"."id"')
        expect(statement).toContain('length("people__exists"."name") > 3')
    })

    it('throws on an unknown relation', () => {
        expect(() => Author.query().existsRelation({ as: 'nope' })).toThrow(/No relation from authors to nope/)
    })

    it('refuses a belongsToMany relation instead of correlating on the wrong key', () => {
        expect(() => Person.query().existsRelation({ as: 'friends' }))
            .toThrow(/belongsToMany relation "friends"/)
    })
})
