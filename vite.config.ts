import {defineConfig} from 'vite';
import monkey from 'vite-plugin-monkey';
import {APP_VERSION} from './src/version';

// Build-variant detection. Unlike Danbooru-Insights, MobileNoteAssist has no
// build-time feature flags (no PERF / DEBUG toggles — debug zones are a
// runtime long-press feature). The `mode` arg is enough to pick between
// the prod (`build`) and dev (`testbuild`) publish branches per PLAN Z7.
const rawBaseURL =
  'https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist/raw';

// https://vitejs.dev/config/
export default defineConfig(({mode}) => {
  const isDev = mode === 'development';
  const publishBranch = isDev ? 'testbuild' : 'build';
  const scriptName = isDev
    ? 'Danbooru Mobile Note Assist (dev)'
    : 'Danbooru Mobile Note Assist';
  const scriptURL = `${rawBaseURL}/${publishBranch}/MobileNoteAssist.user.js`;

  return {
    plugins: [
      monkey({
        entry: 'src/main.ts',
        build: {
          // Legacy v3.1.1 install URL points at MobileNoteAssist.user.js
          // (CamelCase). package.json `name` is npm-lowercase, so override
          // the default `<name>.user.js` filename to keep the publish URL
          // stable across the migration.
          fileName: 'MobileNoteAssist.user.js',
        },
        userscript: {
          name: scriptName,
          namespace: isDev
            ? 'http://tampermonkey.net/danbooru-mobile-note-assist-dev'
            : 'http://tampermonkey.net/',
          version: APP_VERSION,
          description:
            'Touch-friendly translation note editor for Danbooru — multi-note batched Confirm.',
          author: 'AkaringoP with Claude Code',
          match: ['*://danbooru.donmai.us/posts/*'],
          grant: 'none',
          icon: 'https://danbooru.donmai.us/favicon.ico',
          homepageURL:
            'https://github.com/AkaringoP/Danbooru-Mobile-Note-Assist',
          updateURL: scriptURL,
          downloadURL: scriptURL,
        },
      }),
    ],
  };
});
