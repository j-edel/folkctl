#!/usr/bin/env node
import { main } from '../src/main.js';

const exitCode = await main({
  argv: process.argv.slice(2),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  fetchImpl: globalThis.fetch,
});

process.exitCode = exitCode;
