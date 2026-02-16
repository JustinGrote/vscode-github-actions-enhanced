import { context } from 'esbuild';
import { glob } from 'glob';
import { resolve, join, dirname } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { polyfillNode } from "esbuild-plugin-polyfill-node";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const web = process.argv.includes('--web');

const websuffix = web ? '/web' : '';
const platform = web ? 'browser' : 'node'

async function main() {
  const ctx = await context({
    // Separate builds are required because Octokit bundles differently depending on browser vs node
    entryPoints: ["./src/extension.ts"],
    alias: {
      // This is necessary only for libsodium
      'path': 'path-browserify',
    },
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: platform,
    outdir: `dist${websuffix}`,
    external: ['vscode', 'Worker', 'libsodium-wrappers'], // Mark libsodium-wrappers as external
    logLevel: 'warning',
    // Node.js global to browser globalThis
    define: {
      global: 'globalThis',
      PRODUCTION: production.toString() // Add PRODUCTION global variable
    },
     // Added .d.ts to resolve extensions
      treeShaking: true,
      plugins: [
        esbuildProblemMatcherPlugin()
      ]
  });

  // We need language server as esm rather than cjs to load as a process/worker appropriately
  const langServerCtx = await context({
    entryPoints: ['./src/langserver/langserver.ts'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: platform,
    outdir: `dist${websuffix}`,
    logLevel: 'warning',
    define: {
      global: 'globalThis',
      PRODUCTION: production.toString() // Add PRODUCTION global variable
    },
    plugins: [
      //BUG: The language server still incorrectly references Buffer even in its browser-only mode, so we polyfill this.
      ...(platform === 'browser' ? [
        polyfillNode({
          globals: {
            buffer: true,
          }
        })
      ] : []),
      testBundlePlugin,
      esbuildProblemMatcherPlugin(true)
    ],
    treeShaking: true,
  })

  // Run section
  console.log(`📦 [${platform}]: Language Server Worker`)
  await langServerCtx.rebuild();
  console.log(`✅ [${platform}]: Language Server Worker`)
  if (watch) {
    console.log(`👀 [${platform}]: VSCode Extension`)
    await ctx.watch();
  } else {
    console.log(`📦 [${platform}]: VSCode Extension`)
    await ctx.rebuild();
    console.log(`✅ [${platform}]: VSCode Extension`)
    await ctx.dispose();
    process.exit(0);
  }
}

/**
 * For web extension, all tests, including the test runner, need to be bundled into
 * a single module that has a exported `run` function .
 * This plugin bundles implements a virtual file extensionTests.ts that bundles all these together.
 * @type {import('esbuild').Plugin}
 */
const testBundlePlugin = {
  name: 'testBundlePlugin',
  setup(build) {
    build.onResolve({ filter: /[/\\]extensionTests\.ts$/ }, args => {
      if (args.kind === 'entry-point') {
        return { path: resolve(args.path) };
      }
    });
    build.onLoad({ filter: /[/\\]extensionTests\.ts$/ }, async () => {
      const testsRoot = join(dirname, 'src/web/test/suite');
      const files = await glob('*.test.{ts,tsx}', { cwd: testsRoot, posix: true });
      return {
        contents:
          `export { run } from './mochaTestRunner.ts';` +
          files.map(f => `import('./${f}');`).join(''),
        watchDirs: files.map(f => dirname(resolve(testsRoot, f))),
        watchFiles: files.map(f => resolve(testsRoot, f))
      };
    });
  }
};

/**
 * This plugin hooks into the build process to print errors in a format that the problem matcher in
 * Visual Studio Code can understand so it knows when a task is complete before starting debugging.
 * @type {import('esbuild').Plugin}
 * @link https://github.com/connor4312/esbuild-problem-matchers/
 */
function esbuildProblemMatcherPlugin(noWatchMessage = false) {
  return {
    name: 'esbuild-problem-matcher',
    setup(build) {
      build.onStart(() => {
        if (watch && !noWatchMessage) {
          console.log('[watch] build started');
        }
      });
      build.onEnd(result => {
        result.errors.forEach(({ text, location }) => {
          console.error(`✘ [ERROR] ${text}`);
          if (location == null) return;
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        });
        if (watch &&!noWatchMessage) {
            console.log('[watch] build finished');
        }
      });
    }
  };
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
