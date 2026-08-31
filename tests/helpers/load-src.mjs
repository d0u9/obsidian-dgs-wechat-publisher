import esbuild from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

// The plugin sources are TypeScript and import 'obsidian', which only exists inside the app.
// Compile a module on the fly with 'obsidian' stubbed so the pure helpers can be tested directly.
const obsidianStub = {
  name: 'obsidian-stub',
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `
        export class TFile {}
        export const normalizePath = (value) => value.replace(/\\\\/g, '/').replace(/\\/+/g, '/');
        // Enough of the modal surface to exercise the promise-settling logic. Instances register
        // themselves on open, so a test can drive the callbacks Obsidian would call.
        class BaseModal {
          constructor(app) { this.app = app; }
          setPlaceholder() {}
          setTitle() {}
          open() { globalThis.__openModals = [...(globalThis.__openModals ?? []), this]; }
          close() { this.onClose(); }
          onOpen() {}
          onClose() {}
        }
        export class Modal extends BaseModal {}
        export class FuzzySuggestModal extends BaseModal {}
        export class Setting {
          setName() { return this; } setDesc() { return this; } setHeading() { return this; }
          addText() { return this; } addButton() { return this; } addToggle() { return this; }
        }
      `,
      loader: 'js',
    }));
  },
};

export async function loadSrc(entry) {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(`../../src/${entry}`, import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2022',
    platform: 'node',
    packages: 'external',
    plugins: [obsidianStub],
  });
  // The bundle still imports the base library by name, so it has to live inside the project for
  // Node to resolve that specifier — a data: URL module cannot.
  const outDir = fileURLToPath(new URL('../../node_modules/.test-build/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}${entry.replace(/[^\w]/g, '-')}.mjs`;
  writeFileSync(outFile, result.outputFiles[0].text);
  return import(pathToFileURL(outFile).href);
}
