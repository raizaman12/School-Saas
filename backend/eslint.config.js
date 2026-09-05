// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    rules: {
      // Route handlers/middleware intentionally leave unused `req`/`next`
      // params for signature compatibility with Express; underscore-prefixed
      // args are the standard escape hatch.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Prisma's JSON fields, raw query results, and some third-party
      // callback signatures come back as `any` — this codebase already
      // types them explicitly at every real boundary (see validation.ts
      // files), so this stays a warning rather than blocking the build.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
