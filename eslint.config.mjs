import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['coverage/**', 'dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    files: ['src/**/*.service.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@nestjs/common'],
          importNamePattern: '^(?:.*Exception|HttpStatus)$',
          message: 'Application services must throw framework-neutral ApplicationError values; HTTP translation belongs to platform/http.'
        }, {
          group: ['**/database/schema'],
          importNames: ['idempotencyRecords'],
          message: 'Use the PostgreSQL idempotency coordinator; direct idempotency table access is forbidden.'
        }]
      }]
    }
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/database/idempotency/postgres-idempotency.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/database/schema'],
          importNames: ['idempotencyRecords'],
          message: 'Use the PostgreSQL idempotency coordinator; direct idempotency table access is forbidden.'
        }]
      }]
    }
  }
);
