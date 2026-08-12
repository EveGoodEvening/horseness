#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('2.1.228 (Claude Code)\n');
  process.exit(0);
}
if (args[0] !== 'plugin' || args[1] !== 'validate' || !args[2]) {
  process.stderr.write('unsupported hermetic Claude invocation\n');
  process.exit(2);
}
const root = args[2];
const manifestPath = join(root, '.claude-plugin', 'plugin.json');
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const required = [
    join(root, 'skills', 'horseness', 'SKILL.md'),
    join(root, 'agents', 'horseness-worker.md'),
    join(root, 'hooks', 'hooks.json')
  ];
  if (manifest.name !== 'horseness' || required.some((path) => !statSync(path).isFile())) {
    throw new Error('native contribution inventory mismatch');
  }
  process.stdout.write(JSON.stringify({ valid: true, name: manifest.name, contributions: ['skill', 'agent', 'hook'] }) + '\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
