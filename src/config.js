import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CliError } from './errors.js';
import { flagString } from './args.js';
import { stripTrailingSlash } from './util.js';

export const DEFAULT_API_BASE_URL = 'https://api.folk.app';
export const DEFAULT_API_VERSION = '2025-06-09';
const DOTENV_FILES = ['.env', '.env.local'];

export function defaultConfigPath(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'folkctl', 'config.json');
}

export function resolveConfigPath(flags = {}, env = process.env) {
  return flagString(flags, 'config') || env.FOLKCTL_CONFIG || defaultConfigPath(env);
}

export async function readConfig(configPath) {
  try {
    const text = await fs.readFile(configPath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) {
      throw new CliError(`Invalid JSON in config file ${configPath}`, { exitCode: 2, cause: error });
    }
    throw error;
  }
}

export async function writeConfig(configPath, config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const tmp = `${configPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, configPath);
  try {
    await fs.chmod(configPath, 0o600);
  } catch {
    // chmod may fail on Windows. The file is still usable.
  }
}

export async function removeConfigToken(configPath) {
  const config = await readConfig(configPath);
  delete config.apiKey;
  await writeConfig(configPath, config);
}

export async function readDotEnvConfig({ cwd = process.cwd() } = {}) {
  const values = {};
  const sources = {};
  for (const fileName of DOTENV_FILES) {
    const filePath = path.join(cwd, fileName);
    let text;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const [key, value] of Object.entries(parseDotEnv(text))) {
      values[key] = value;
      sources[key] = fileName;
    }
  }
  return { values, sources };
}

export function parseDotEnv(text) {
  const values = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = parseDotEnvValue(match[2]);
  }
  return values;
}

function parseDotEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return unescapeQuoted(trimmed.slice(1, -1));
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  const commentIndex = trimmed.search(/\s#/);
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trimEnd();
}

function unescapeQuoted(value) {
  return value.replace(/\\([nrt"\\])/g, (_, char) => {
    if (char === 'n') return '\n';
    if (char === 'r') return '\r';
    if (char === 't') return '\t';
    return char;
  });
}

function valueSource(key, env, dotenvSources, fileConfig) {
  if (env[key]) return `env:${key}`;
  if (dotenvSources[key]) return `${dotenvSources[key]}:${key}`;
  if (fileConfig[keyToConfigName(key)]) return 'config';
  return 'none';
}

function keyToConfigName(key) {
  if (key === 'FOLK_API_KEY') return 'apiKey';
  if (key === 'FOLK_API_VERSION') return 'apiVersion';
  if (key === 'FOLK_API_BASE_URL') return 'baseUrl';
  return key;
}

export async function getEffectiveConfig({ flags = {}, env = process.env, cwd = process.cwd() } = {}) {
  const dotenv = await readDotEnvConfig({ cwd });
  const dotenvEnv = {
    ...(dotenv.values.FOLK_API_KEY ? { FOLK_API_KEY: dotenv.values.FOLK_API_KEY } : {}),
    ...(dotenv.values.FOLK_API_VERSION ? { FOLK_API_VERSION: dotenv.values.FOLK_API_VERSION } : {}),
  };
  const effectiveEnv = { ...dotenvEnv, ...env };
  const configPath = resolveConfigPath(flags, env);
  const fileConfig = await readConfig(configPath);
  const apiKey = effectiveEnv.FOLK_API_KEY || fileConfig.apiKey;
  const apiVersion = flagString(flags, 'api-version') || effectiveEnv.FOLK_API_VERSION || fileConfig.apiVersion || DEFAULT_API_VERSION;
  const baseUrl = stripTrailingSlash(flagString(flags, 'base-url') || env.FOLK_API_BASE_URL || fileConfig.baseUrl || DEFAULT_API_BASE_URL);
  return {
    configPath,
    fileConfig,
    apiKey,
    apiKeySource: valueSource('FOLK_API_KEY', env, dotenv.sources, fileConfig),
    apiVersion,
    baseUrl,
  };
}
