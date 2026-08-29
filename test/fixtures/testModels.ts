import {
    BelongsTo,
    BelongsToMany,
    CreatedColumn,
    DataType,
    DeletedColumn,
    ForeignKey,
    HasMany,
    HasOne,
    NamedColumn,
    Table,
    UpdatedColumn,
} from '../../src'
import { QueryableModel } from '../../src'

export type TAuthorCA = { name: string; age?: number }

@Table('authors')
export class Author extends QueryableModel<Author, TAuthorCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    // column name omitted on purpose -> defaults to snake_case of property
    @NamedColumn(DataType.STRING)
    name: string

    // camelCase property -> default column name must be snake_case
    @NamedColumn(DataType.STRING)
    firstName: string

    @NamedColumn(DataType.INTEGER, 'age')
    age: number

    @NamedColumn(DataType.BOOLEAN, 'active')
    active: boolean

    @NamedColumn(DataType.TEXT, 'bio')
    bio: string

    @NamedColumn(DataType.JSONB, 'meta')
    meta: Record<string, unknown>

    @CreatedColumn()
    @NamedColumn(DataType.DATE, 'created_at')
    createdAt: Date

    @UpdatedColumn()
    @NamedColumn(DataType.DATE, 'updated_at')
    updatedAt: Date

    @HasMany(() => Book)
    books: Book[]

    @BelongsToMany(() => Tag, { through: () => AuthorTag })
    tags: Tag[]

    // computed getter (not a column) — must survive accessor installation
    get displayName(): string {
        return `${this.firstName} ${this.name}`
    }
}

export type TBookCA = { title: string; authorId: number; rating?: number }

@Table('books')
export class Book extends QueryableModel<Book, TBookCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'title')
    title: string

    @NamedColumn(DataType.FLOAT, 'rating')
    rating: number

    @NamedColumn(DataType.ENUM('draft', 'published'), 'status')
    status: 'draft' | 'published'

    @ForeignKey(() => Author)
    @NamedColumn(DataType.BIGINT, 'author_id')
    authorId: number

    @BelongsTo(() => Author)
    author: Author

    @HasMany(() => Review)
    reviews: Review[]
}

export type TReviewCA = { text: string; bookId: number }

@Table('reviews')
export class Review extends QueryableModel<Review, TReviewCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.TEXT, 'text')
    text: string

    @ForeignKey(() => Book)
    @NamedColumn(DataType.BIGINT, 'book_id')
    bookId: number

    @BelongsTo(() => Book)
    book: Book
}

@Table('tags')
export class Tag extends QueryableModel<Tag, { label: string }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'label')
    label: string
}

@Table('author_tags')
export class AuthorTag extends QueryableModel<AuthorTag, { authorId: number; tagId: number }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @ForeignKey(() => Author)
    @NamedColumn(DataType.BIGINT, 'author_id')
    authorId: number

    @BelongsTo(() => Author)
    author: Author

    @ForeignKey(() => Tag)
    @NamedColumn(DataType.BIGINT, 'tag_id')
    tagId: number

    @BelongsTo(() => Tag)
    tag: Tag
}

export type TSoftCA = { title: string }

@Table({ tableName: 'soft_entities', paranoid: true })
export class SoftEntity extends QueryableModel<SoftEntity, TSoftCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'title')
    title: string

    @DeletedColumn()
    @NamedColumn(DataType.DATE, 'deleted_at')
    deletedAt: Date
}

@Table('profiles')
export class Profile extends QueryableModel<Profile, { bio: string }> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.TEXT, 'bio')
    bio: string

    @NamedColumn(DataType.STRING, 'slug', { allowNull: false })
    slug: string

    @NamedColumn(DataType.JSON, 'settings')
    settings: Record<string, unknown>

    @HasOne(() => Author)
    owner: Author
}
