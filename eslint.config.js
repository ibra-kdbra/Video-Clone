import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint rules for the TypeScript packages (API, worker, contracts). The web app has its own
 * eslint.config.js in apps/web.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/web/**', '**/coverage/**'] },
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts', 'packages/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // Nest injects by constructor parameter types, so those imports must stay value imports.
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.spec.ts', 'apps/api/src/database/migrate.ts', 'apps/api/src/database/migrator.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
  },
);
