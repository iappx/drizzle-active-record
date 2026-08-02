export class StringUtils {
    public static toSnakeCase(value: string): string {
        return value.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, '')
    }

    public static toPascalCase(value: string): string {
        return value.replace(/_([a-zA-Z0-9])/g, (_m, c: string) => c.toUpperCase())
            .replace(/^[a-z]/, (m) => m.toUpperCase())
    }
}
