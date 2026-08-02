import { Hydrator, SchemaBuilder, SnakeCaseNamingStrategy } from '../src'
import { Author, Book, Review, Tag } from './fixtures/testModels'

beforeAll(() => {
    SchemaBuilder.setNamingStrategy(new SnakeCaseNamingStrategy())
    SchemaBuilder.build()
})

describe('Hydrator.hydrate — null handling', () => {
    it('returns null for a null/undefined row', () => {
        expect(Hydrator.hydrate(Author, null)).toBeNull()
        expect(Hydrator.hydrate(Author, undefined)).toBeNull()
    })
})

describe('Hydrator.hydrate — columns', () => {
    it('stores column values in dataValues, not as own properties', () => {
        const a = Hydrator.hydrate(Author, { id: 1, name: 'A' }) as Author
        expect(a.dataValues).toMatchObject({ id: 1, name: 'A' })
        expect(Object.prototype.hasOwnProperty.call(a, 'name')).toBe(false)
        expect(a.name).toBe('A') // via prototype getter
    })

    it('leaves the instance clean (no changed fields) after hydration', () => {
        const a = Hydrator.hydrate(Author, { id: 1, name: 'A' }) as Author
        expect(a.changed()).toBe(false)
    })

    it('only copies columns present in the row', () => {
        const a = Hydrator.hydrate(Author, { id: 1 }) as Author
        expect(a.id).toBe(1)
        expect(a.name).toBeUndefined()
        expect('name' in a.dataValues).toBe(false)
    })
})

describe('Hydrator.hydrate — computed / extras', () => {
    it('copies non-column, non-relation keys as own properties', () => {
        const a = Hydrator.hydrate(Author, { id: 1, name: 'A', booksCount: 7 }) as any
        expect(a.booksCount).toBe(7)
        expect(Object.prototype.hasOwnProperty.call(a, 'booksCount')).toBe(true)
    })
})

describe('Hydrator.hydrate — relations', () => {
    it('hydrates a belongsTo relation into a single instance', () => {
        const b = Hydrator.hydrate(Book, {
            id: 1,
            title: 'T',
            authorId: 2,
            author: { id: 2, name: 'A' },
        }) as Book
        expect(b.author).toBeInstanceOf(Author)
        expect(b.author.name).toBe('A')
    })

    it('hydrates a hasMany relation into an array of instances', () => {
        const a = Hydrator.hydrate(Author, {
            id: 1,
            name: 'A',
            books: [
                { id: 10, title: 'One', authorId: 1 },
                { id: 11, title: 'Two', authorId: 1 },
            ],
        }) as Author
        expect(a.books).toHaveLength(2)
        expect(a.books[0]).toBeInstanceOf(Book)
        expect(a.books.map(b => b.title)).toEqual(['One', 'Two'])
    })

    it('keeps a null relation value as null (no crash)', () => {
        const b = Hydrator.hydrate(Book, { id: 1, title: 'T', authorId: null, author: null }) as Book
        expect(b.author).toBeNull()
    })

    it('leaves a relation property untouched when absent from the row', () => {
        const b = Hydrator.hydrate(Book, { id: 1, title: 'T' }) as Book
        expect(b.author).toBeUndefined()
    })

    it('flattens a belongsToMany relation from junction rows to target instances', () => {
        const a = Hydrator.hydrate(Author, {
            id: 1,
            name: 'A',
            tags: [
                { id: 10, authorId: 1, tagId: 100, tag: { id: 100, label: 'x' } },
                { id: 11, authorId: 1, tagId: 101, tag: { id: 101, label: 'y' } },
            ],
        }) as Author
        expect(a.tags).toHaveLength(2)
        expect(a.tags[0]).toBeInstanceOf(Tag)
        expect(a.tags.map(t => t.label)).toEqual(['x', 'y'])
    })

    it('drops junction rows that have no target object', () => {
        const a = Hydrator.hydrate(Author, {
            id: 1,
            name: 'A',
            tags: [{ id: 10, authorId: 1, tagId: 100, tag: null }],
        }) as Author
        expect(a.tags).toEqual([])
    })

    it('hydrates deeply nested relations recursively', () => {
        const a = Hydrator.hydrate(Author, {
            id: 1,
            name: 'A',
            books: [
                {
                    id: 10,
                    title: 'One',
                    authorId: 1,
                    reviews: [{ id: 100, text: 'Great', bookId: 10 }],
                },
            ],
        }) as Author
        const review = a.books[0].reviews[0]
        expect(review).toBeInstanceOf(Review)
        expect(review.text).toBe('Great')
        expect(review.changed()).toBe(false)
    })
})

describe('Hydrator.hydrateMany', () => {
    it('hydrates each row into an instance', () => {
        const list = Hydrator.hydrateMany(Author, [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
        ])
        expect(list).toHaveLength(2)
        expect(list[0]).toBeInstanceOf(Author)
        expect(list.map(a => a.name)).toEqual(['A', 'B'])
    })

    it('returns an empty array for no rows', () => {
        expect(Hydrator.hydrateMany(Author, [])).toEqual([])
    })
})
