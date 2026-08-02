import {
    and as dAnd,
    between as dBetween,
    eq as dEq,
    gt as dGt,
    gte as dGte,
    ilike as dILike,
    inArray,
    isNotNull as dIsNotNull,
    isNull as dIsNull,
    like as dLike,
    lt as dLt,
    lte as dLte,
    ne as dNe,
    not as dNot,
    notIlike as dNotILike,
    notInArray,
    notLike as dNotLike,
    or as dOr,
    SQL,
} from 'drizzle-orm'

export class Op {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private constructor(private readonly builder: (column: any) => SQL) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build(column: any): SQL {
        return this.builder(column)
    }

    static eq(value: unknown): Op {
        return new Op(c => (value === null ? dIsNull(c) : dEq(c, value)))
    }

    static ne(value: unknown): Op {
        return new Op(c => (value === null ? dIsNotNull(c) : dNe(c, value)))
    }

    static gt(value: unknown): Op {
        return new Op(c => dGt(c, value))
    }

    static gte(value: unknown): Op {
        return new Op(c => dGte(c, value))
    }

    static lt(value: unknown): Op {
        return new Op(c => dLt(c, value))
    }

    static lte(value: unknown): Op {
        return new Op(c => dLte(c, value))
    }

    static like(value: string): Op {
        return new Op(c => dLike(c, value))
    }

    static notLike(value: string): Op {
        return new Op(c => dNotLike(c, value))
    }

    static iLike(value: string): Op {
        return new Op(c => dILike(c, value))
    }

    static notILike(value: string): Op {
        return new Op(c => dNotILike(c, value))
    }

    static in(values: unknown[]): Op {
        return new Op(c => inArray(c, values))
    }

    static notIn(values: unknown[]): Op {
        return new Op(c => notInArray(c, values))
    }

    static between(from: unknown, to: unknown): Op {
        return new Op(c => dBetween(c, from, to))
    }

    static notBetween(from: unknown, to: unknown): Op {
        return new Op(c => dNot(dBetween(c, from, to)))
    }

    static isNull(): Op {
        return new Op(c => dIsNull(c))
    }

    static isNotNull(): Op {
        return new Op(c => dIsNotNull(c))
    }

    static and(...conditions: Op[]): Op {
        return new Op(c => dAnd(...conditions.map(x => x.build(c))) as SQL)
    }

    static or(...conditions: Op[]): Op {
        return new Op(c => dOr(...conditions.map(x => x.build(c))) as SQL)
    }
}
