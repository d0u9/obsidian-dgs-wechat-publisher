import esbuild from 'esbuild';
import process from 'node:process';
import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';

/**
 * The base library exposes a `readMarkdownFile` helper this plugin never calls — it hands the
 * library text it has already read through the vault API. Tree shaking drops the function but
 * keeps the `require`, which would leave the bundle claiming filesystem access it does not use.
 * Replacing the module with something that throws keeps that honest: the bundle cannot read a file
 * through the library, and an accidental use fails loudly instead of quietly working.
 */
const noFilesystem = {
  name: 'no-filesystem',
  setup(build) {
    build.onResolve({ filter: /^node:fs(\/promises)?$/ }, (args) => ({ path: args.path, namespace: 'no-fs' }));
    build.onLoad({ filter: /.*/, namespace: 'no-fs' }, () => ({
      contents: `
        const refuse = () => { throw new Error('This plugin does not read files through node:fs.'); };
        export const readFile = refuse;
        export const writeFile = refuse;
        export default { readFile: refuse, writeFile: refuse };
      `,
      loader: 'js',
    }));
  },
};

const production = process.argv[2] === 'production';
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', 'node:*', ...builtinModules],
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  plugins: [noFilesystem],
  outfile: 'main.js',
});

if (production) {
  await context.rebuild();
  await context.dispose();

  // The plugin's only filesystem access is Obsidian's own readLocalFile; keep it that way.
  const bundle = readFileSync('main.js', 'utf8');
  const forbidden = [/require\("node:fs(\/promises)?"\)/, /\bBuffer\.from\b/];
  for (const pattern of forbidden) {
    if (pattern.test(bundle)) {
      console.error(`Build contains ${pattern}, which this plugin is not supposed to use.`);
      process.exit(1);
    }
  }
} else {
  await context.watch();
}
