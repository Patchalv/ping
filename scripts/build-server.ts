// Bundles the server's deployed entry points into plain JavaScript in apps/server/dist/, so
// the image runs `node dist/index.js` instead of compiling TypeScript at startup through tsx. On a
// 256 MB Machine, tsx's esbuild service and on-the-fly compiling cost about 10 s of boot
// and tens of MB, and a second `node --import tsx` over `fly ssh console` ran the
// Machine out of memory.
//
// dist/index.js sits at the same depth as src/index.ts, so the `new URL('…',
// import.meta.url)` paths it inlines from index.ts and config.ts still resolve. The two
// CLI bundles are for the image, where there is no .env.local to find.
// Dependencies stay in node_modules; only workspace packages (@ping/shared, which ships
// TypeScript) are bundled in.
import { build } from 'esbuild';

const serverDir = new URL('../apps/server/', import.meta.url).pathname;

await build({
  entryPoints: ['src/index.ts', 'src/db/cli/pooler-smoke.ts', 'src/db/cli/bootstrap-admin.ts'],
  absWorkingDir: serverDir,
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'warning',
  plugins: [
    {
      name: 'external-dependencies',
      setup(pluginBuild) {
        // Bare specifiers (hono, pg, node:fs…) stay imports; @ping/* is bundled.
        pluginBuild.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@ping/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
