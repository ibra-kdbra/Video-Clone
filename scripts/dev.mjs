/**
 * `npm run dev` for the API and the worker: compiles TypeScript in watch mode and restarts the app
 * whenever the output changes. Run from the app's directory; reads the repository's .env.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const node = process.execPath;

execFileSync(node, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
const children = [
  spawn(node, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { stdio: ['ignore', 'ignore', 'inherit'] }),
  spawn(node, ['--env-file-if-exists=../../.env', '--watch-path=dist', 'dist/main.js'], { stdio: 'inherit' }),
];
const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children[1].on('exit', (code) => {
  stop();
  process.exit(code ?? 0);
});
