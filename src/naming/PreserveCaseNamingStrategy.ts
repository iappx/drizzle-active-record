import { INamingStrategy } from './INamingStrategy'

export class PreserveCaseNamingStrategy implements INamingStrategy {
    public columnName(propertyKey: string): string {
        return propertyKey
    }
}
