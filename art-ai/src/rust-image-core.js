import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreDirectory = path.resolve(moduleDirectory, '../../upscaled/rust_core');

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function outputField(output, name) {
  return new RegExp(`(?:^|\\s)${name}=([^\\s]+)`).exec(output)?.[1] || '';
}

export class RustImageCore {
  constructor({ enabled = false, directory = defaultCoreDirectory, cargo = 'cargo', runner = execFile } = {}) {
    this.enabled = enabled;
    this.directory = path.resolve(directory);
    this.cargo = cargo;
    this.runner = runner;
  }

  async execute(command, args) {
    if (!this.enabled) throw new Error('Rust image core is disabled');
    const { stdout } = await this.runner(this.cargo, ['run', '--quiet', '--', command, ...args], {
      cwd: this.directory,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return String(stdout || '').trim();
  }

  async inspect(source) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('Source path is required');
    const output = await this.execute('inspect', [path.resolve(source)]);
    const width = Number(outputField(output, 'width'));
    const height = Number(outputField(output, 'height'));
    const sha256 = outputField(output, 'sha256');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error('Rust image core returned an invalid inspection result');
    }
    return { width, height, sha256 };
  }

  async plan({ longEdge, target, maxScale = 4, maxPasses = 4 } = {}) {
    positiveInteger(longEdge, 'Long edge');
    positiveInteger(target, 'Target');
    if (!Number.isFinite(maxScale) || maxScale <= 1) throw new Error('Maximum scale must exceed 1');
    positiveInteger(maxPasses, 'Maximum passes');
    const output = await this.execute('plan', [
      '--long-edge', String(longEdge),
      '--target', String(target),
      '--max-scale', String(maxScale),
      '--max-passes', String(maxPasses),
    ]);
    const value = outputField(output, 'passes');
    const passes = value ? value.split(',').map(Number) : [];
    if (passes.some((pass) => !Number.isFinite(pass) || pass <= 1)) {
      throw new Error('Rust image core returned an invalid scale plan');
    }
    return { passes };
  }

  async preflight({ source, longEdge, target, maxScale = 4, maxPasses = 4 } = {}) {
    const inspection = await this.inspect(source);
    const plan = await this.plan({ longEdge, target, maxScale, maxPasses });
    return { inspection, ...plan };
  }
}

export function createRustImageCore(options) {
  return new RustImageCore(options);
}