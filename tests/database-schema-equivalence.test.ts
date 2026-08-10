import { createHash } from 'node:crypto';

import { getTableName, isTable, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, type AnyPgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as compatibilitySchema from '../src/database/schema';
import * as boundedSchema from '../src/database/schema/index';

const EXPECTED_SCHEMA_FINGERPRINT = '154730a48fa52feda879a473657b88e77969b47e7ebf6d2f4faebdb6161cdd1c';
const dialect = new PgDialect();

function sqlValue(value: unknown): unknown {
  if (value === undefined) return null;
  return value instanceof SQL ? dialect.sqlToQuery(value).sql : value;
}

function indexColumnValue(column: unknown): unknown {
  if (
    typeof column === 'object'
    && column !== null
    && 'name' in column
    && typeof column.name === 'string'
  ) return column.name;
  return sqlValue(column);
}

function schemaFingerprint(schema: Record<string, unknown>): string {
  const tables = Object.entries(schema)
    .filter((entry): entry is [string, AnyPgTable] => isTable(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, table]) => {
      const config = getTableConfig(table);
      return {
        key,
        name: config.name,
        columns: config.columns.map((column) => ({
          name: column.name,
          type: column.getSQLType(),
          notNull: column.notNull,
          primary: column.primary,
          hasDefault: column.hasDefault,
          default: sqlValue(column.default)
        })),
        indexes: config.indexes.map((index) => ({
          name: index.config.name,
          unique: index.config.unique,
          method: index.config.method,
          columns: index.config.columns.map(indexColumnValue),
          where: sqlValue(index.config.where)
        })),
        foreignKeys: config.foreignKeys.map((foreignKey) => {
          const reference = foreignKey.reference();
          return {
            name: foreignKey.getName(),
            columns: reference.columns.map((column) => column.name),
            foreignTable: getTableName(reference.foreignTable),
            foreignColumns: reference.foreignColumns.map((column) => column.name),
            onDelete: foreignKey.onDelete ?? null,
            onUpdate: foreignKey.onUpdate ?? null
          };
        }),
        checks: config.checks.map((check) => ({ name: check.name, value: sqlValue(check.value) })),
        primaryKeys: config.primaryKeys.map((primaryKey) => ({
          name: primaryKey.getName(),
          columns: primaryKey.columns.map((column) => column.name)
        })),
        uniqueConstraints: config.uniqueConstraints.map((constraint) => ({
          name: constraint.getName(),
          columns: constraint.columns.map((column) => column.name)
        }))
      };
    });

  return createHash('sha256').update(JSON.stringify(tables)).digest('hex');
}

describe('bounded database schema exports', () => {
  it('keeps the compatibility barrel identical to the bounded schema index', () => {
    expect(Object.keys(compatibilitySchema).sort()).toEqual(Object.keys(boundedSchema).sort());
    for (const [name, value] of Object.entries(boundedSchema)) {
      expect(compatibilitySchema[name as keyof typeof compatibilitySchema]).toBe(value);
    }
  });

  it('preserves the exact table metadata fingerprint from the monolithic schema', () => {
    expect(schemaFingerprint(compatibilitySchema)).toBe(EXPECTED_SCHEMA_FINGERPRINT);
  });

  it('retains the complete table and constraint inventory without duplicate physical names', () => {
    const schemaValues: unknown[] = Object.values(compatibilitySchema);
    const configs = schemaValues
      .filter((value): value is AnyPgTable => isTable(value))
      .map(getTableConfig);
    const physicalNames = configs.map((config) => config.name);

    expect(new Set(physicalNames).size).toBe(physicalNames.length);
    expect({
      tables: configs.length,
      columns: configs.reduce((count, config) => count + config.columns.length, 0),
      indexes: configs.reduce((count, config) => count + config.indexes.length, 0),
      foreignKeys: configs.reduce((count, config) => count + config.foreignKeys.length, 0),
      checks: configs.reduce((count, config) => count + config.checks.length, 0),
      primaryKeys: configs.reduce((count, config) => count + config.primaryKeys.length, 0),
      rowLevelSecurityTables: configs.filter((config) => config.enableRLS).length
    }).toEqual({
      tables: 44,
      columns: 517,
      indexes: 62,
      foreignKeys: 60,
      checks: 98,
      primaryKeys: 11,
      rowLevelSecurityTables: 0
    });
  });
});
