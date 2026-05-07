// ESLint v9 flat config — composes the gts (Google TypeScript Style)
// rules manually because gts@7.0.0's bundled `eslint.config.js` has a
// broken path (`./src/index.js` instead of `./build/src/index.js`) and
// fails to load under ESLint v9. Instead we import the actual rule module
// from `gts/build/src/index.js` and the ignore list from `gts/eslint.ignores.js`.
//
// Once gts ships a fix, this can be reduced to:
//   import gtsConfig from 'gts/eslint.config.js';
//   export default gtsConfig;
//
// Posture: strict. No rule is relaxed from gts defaults. The only override
// below widens `no-unused-vars` to honor the conventional `_` prefix, which
// is the standard escape hatch for intentionally-unused parameters and
// avoids any need for file-level eslint-disable comments.
import {defineConfig} from 'eslint/config';
import gtsRules from 'gts/build/src/index.js';
import gtsIgnores from 'gts/eslint.ignores.js';

export default defineConfig([
  // Ignore build output, ESLint's own config file (which gts's TS parser
  // tries to parse as a script despite `type: "module"` in package.json),
  // and the legacy single-file userscript that remains the source of truth
  // until Phase 4 (PLAN Z2). The legacy file is plain JS with bespoke
  // formatting and is not subject to gts review.
  {
    ignores: [
      ...gtsIgnores,
      'dist/',
      'eslint.config.js',
      'MobileNoteAssist.user.js',
    ],
  },
  ...gtsRules,
  // Project-wide overrides applied after gts so they take precedence.
  // The `files` scope must match gts's own TS block — that's where the
  // `@typescript-eslint` plugin is registered (via `extends: [tseslint.configs.recommended]`).
  // Without this scope, ESLint tries to apply the `@typescript-eslint/*` rule
  // to files where the plugin isn't loaded and aborts with a plugin-not-found error.
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Allow the `_foo` prefix convention for intentionally unused parameters,
      // caught destructures, and rest siblings. Keeps the typical escape hatch
      // working without introducing file-level disables.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);
