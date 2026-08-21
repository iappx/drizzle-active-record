import { BelongsTo, DataType, ForeignKey, HasMany, NamedColumn, QueryableModel, Table } from '../../src'

export type TCategoryCA = { title: string; parentId?: number }

/** Self-referencing model: the shape a recursive query walks. */
@Table('categories')
export class Category extends QueryableModel<Category, TCategoryCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'title')
    title: string

    @ForeignKey(() => Category)
    @NamedColumn(DataType.BIGINT, 'parent_id')
    parentId: number

    @BelongsTo(() => Category)
    parent: Category

    @HasMany(() => Category)
    children: Category[]

    @HasMany(() => Article)
    articles: Article[]
}

export type TArticleCA = { title: string; categoryId: number }

/** Hangs off the recursion: proves relations load in the same statement. */
@Table('articles')
export class Article extends QueryableModel<Article, TArticleCA> {
    @NamedColumn(DataType.BIGINT, 'id', { primaryKey: true, autoIncrement: true })
    id: number

    @NamedColumn(DataType.STRING, 'title')
    title: string

    @NamedColumn(DataType.BOOLEAN, 'published')
    published: boolean

    @ForeignKey(() => Category)
    @NamedColumn(DataType.BIGINT, 'category_id')
    categoryId: number

    @BelongsTo(() => Category)
    category: Category
}
