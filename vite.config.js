import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

/**
 * Work out a version string that always moves when a build is pushed.
 *
 * The badge used to be a hand-edited constant, so it drifted: the app cheerfully
 * reported v124 while running code from a build numbered 118, and there was no
 * way to tell from a screenshot which code someone was actually running.
 *
 * Preference order:
 *   1. BUILD_NUMBER from CI — the same number TestFlight shows, so a tester
 *      saying "118" and the build list agree.
 *   2. Locally, the git commit count and short SHA — monotonic, and it
 *      identifies the exact tree without any release ceremony.
 *   3. 'dev' when there's no git at all (a tarball, a fresh container).
 */
function resolveVersion(){
  if (process.env.BUILD_NUMBER) return `b${process.env.BUILD_NUMBER}`;
  try {
    const count = execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const sha   = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${count}·${sha}`;
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    // Injected at build time so the running app can state exactly what it is.
    __APP_VERSION__: JSON.stringify(resolveVersion()),
  },
  build: {
    outDir: 'dist',
    // Copy static assets that Vite doesn't process automatically
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/main.js'],
    },
  },
});
