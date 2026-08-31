// The configuration the plugin directory's automated review runs, so its findings can be
// reproduced here instead of read off a web page.
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default tseslint.config(
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { ignores: ['main.js', 'esbuild.config.mjs', 'eslint.config.mjs', 'scripts/**', 'tests/**'] },
);
