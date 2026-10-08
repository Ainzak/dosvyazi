import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/obj/**', '**/bin/**', '.local/**', 'apps/web/src/api/schema.d.ts'] },
  js.configs.recommended,
  { files: ['**/*.mjs', '**/*.js'], languageOptions: { globals: globals.node } },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['apps/web/src/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: { ...reactHooks.configs.recommended.rules, 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] } },
);
