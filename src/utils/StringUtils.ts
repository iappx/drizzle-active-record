/** Case conversions shared by the naming strategies. */
export class StringUtils {
    /**
     * Converts a camelCase or PascalCase identifier to `snake_case`.
     *
     * Every capital becomes an underscore plus its lower case form; a leading underscore produced that
     * way is dropped.
     *
     * @example
     * ```ts
     * StringUtils.toSnakeCase('firstName') // 'first_name'
     * StringUtils.toSnakeCase('FirstName') // 'first_name'
     * ```
     */
    public static toSnakeCase(value: string): string {
        return value.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, '')
    }

    /**
     * Converts a snake_case or camelCase identifier to `PascalCase`.
     *
     * Each underscore is removed and the character after it is upper-cased, as is the first one.
     *
     * @example
     * ```ts
     * StringUtils.toPascalCase('first_name') // 'FirstName'
     * StringUtils.toPascalCase('firstName') // 'FirstName'
     * ```
     */
    public static toPascalCase(value: string): string {
        return value.replace(/_([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase())
            .replace(/^[a-z]/, (m) => m.toUpperCase())
    }
}
