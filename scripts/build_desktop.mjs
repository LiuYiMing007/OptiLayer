import { spawnSync } from 'node:child_process';
const command = 'node_modules/@tauri-apps/cli/tauri.js';
const args = [command, 'build', '--config', 'src-tauri/tauri.release.conf.json'];
if (process.platform === 'win32') args.push('--no-bundle');
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
