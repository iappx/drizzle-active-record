import { integer, pgTable, PgDialect, text } from 'drizzle-orm/pg-core'
import { Op } from '../../src'

const t = pgTable('t', {
    id: integer('id'),
    name: text('name'),
})

const dialect = new PgDialect()
const compile = (op: Op, column: any) => dialect.sqlToQuery(op.build(column))
const text_ = (op: Op, column: any) => compile(op, column).sql.toLowerCase()

describe('Op — comparison', () => {
    it('eq -> "="', () => {
        const q = compile(Op.eq(5), t.id)
        expect(q.sql).toContain('=')
        expect(q.params).toEqual([5])
    })

    it('eq(null) -> "is null"', () => {
        expect(text_(Op.eq(null), t.id)).toContain('is null')
    })

    it('ne -> "<>"', () => {
        expect(compile(Op.ne(5), t.id).sql).toContain('<>')
    })

    it('ne(null) -> "is not null"', () => {
        expect(text_(Op.ne(null), t.id)).toContain('is not null')
    })

    it('gt / gte / lt / lte', () => {
        expect(compile(Op.gt(1), t.id).sql).toContain('>')
        expect(compile(Op.gte(1), t.id).sql).toContain('>=')
        expect(compile(Op.lt(1), t.id).sql).toContain('<')
        expect(compile(Op.lte(1), t.id).sql).toContain('<=')
    })
})

describe('Op — set / range', () => {
    it('in -> "in (...)" with all params', () => {
        const q = compile(Op.in([1, 2, 3]), t.id)
        expect(q.sql.toLowerCase()).toContain('in (')
        expect(q.params).toEqual([1, 2, 3])
    })

    it('notIn -> "not in"', () => {
        expect(compile(Op.notIn([1, 2]), t.id).sql.toLowerCase()).toContain('not in')
    })

    it('between -> "between" with two params', () => {
        const q = compile(Op.between(1, 10), t.id)
        expect(q.sql.toLowerCase()).toContain('between')
        expect(q.params).toEqual([1, 10])
    })

    it('notBetween -> "not (... between ...)"', () => {
        const s = text_(Op.notBetween(1, 10), t.id)
        expect(s).toContain('not')
        expect(s).toContain('between')
    })
})

describe('Op — string', () => {
    it('like / notLike', () => {
        expect(text_(Op.like('%a%'), t.name)).toContain('like')
        expect(text_(Op.notLike('%a%'), t.name)).toContain('not like')
    })

    it('iLike / notILike', () => {
        expect(text_(Op.iLike('%a%'), t.name)).toContain('ilike')
        expect(text_(Op.notILike('%a%'), t.name)).toContain('not ilike')
    })
})

describe('Op — null', () => {
    it('isNull -> "is null"', () => {
        expect(text_(Op.isNull(), t.id)).toContain('is null')
    })

    it('isNotNull -> "is not null"', () => {
        expect(text_(Op.isNotNull(), t.id)).toContain('is not null')
    })
})

describe('Op — combinators', () => {
    it('and joins conditions on one column', () => {
        const q = compile(Op.and(Op.gt(1), Op.lt(10)), t.id)
        expect(q.sql.toLowerCase()).toContain('and')
        expect(q.params).toEqual([1, 10])
    })

    it('or joins conditions on one column', () => {
        const q = compile(Op.or(Op.eq('a'), Op.eq('b')), t.name)
        expect(q.sql.toLowerCase()).toContain('or')
        expect(q.params).toEqual(['a', 'b'])
    })

    it('nested and/or compose', () => {
        const q = compile(Op.and(Op.gt(0), Op.or(Op.eq('a'), Op.eq('b'))), t.name)
        expect(q.sql.toLowerCase()).toContain('and')
        expect(q.sql.toLowerCase()).toContain('or')
        expect(q.params).toEqual([0, 'a', 'b'])
    })
})
