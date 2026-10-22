#!/usr/bin/env node
// Release check: the companion skill must install exactly the CLI source this checkout releases.
// Run it after committing the skill pin, before tagging:
//
//   node scripts/check-skill-pin.mjs
//
// It fails when the pinned commit's package.json version differs from this checkout's, when SKILL.md
// expects another version, or when bin/, src/, package.json, or package-lock.json differ between the
// pinned commit and HEAD.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const skill = read('skills/folk-cli/SKILL.md');
const version = JSON.parse(read('package.json')).version;
const pins = [...skill.matchAll(/github:j-edel\/folkctl#([a-f0-9]{40})/g)].map((match) => match[1]);
const expected = skill.match(/The expected CLI version is `([^`]+)`/)?.[1];
const problems = [];

if (!pins.length) problems.push('SKILL.md has no github:j-edel/folkctl#<commit> install source.');
if (new Set(pins).size > 1) problems.push(`SKILL.md pins different commits: ${[...new Set(pins)].join(', ')}.`);
if (expected !== version) problems.push(`SKILL.md expects CLI ${expected}, but package.json is ${version}.`);

const uncommitted = git('status', '--porcelain', '--', 'bin', 'src', 'package.json', 'package-lock.json', 'skills').split('\n').filter(Boolean);
if (uncommitted.length) problems.push(`Commit these changes first; the check compares commits:\n  ${uncommitted.join('\n  ')}`);

const pin = pins[0];
if (pin) {
  let pinnedVersion;
  try {
    pinnedVersion = JSON.parse(git('show', `${pin}:package.json`)).version;
  } catch {
    problems.push(`Pinned commit ${pin} is not in this repository. Fetch it, or pin a commit that is.`);
  }
  if (pinnedVersion !== undefined && pinnedVersion !== version) {
    problems.push(`The pin ${pin.slice(0, 7)} installs CLI ${pinnedVersion}, but package.json is ${version}. Commit the CLI first, then pin that commit.`);
  }
  if (pinnedVersion !== undefined) {
    const changed = git('diff', '--name-only', pin, 'HEAD', '--', 'bin', 'src', 'package.json', 'package-lock.json').trim();
    if (changed) problems.push(`CLI files differ between the pin ${pin.slice(0, 7)} and HEAD:\n  ${changed.split('\n').join('\n  ')}`);
  }
}

if (problems.length) {
  console.error(`Skill pin check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Skill pin ${pin.slice(0, 7)} installs CLI ${version}, and its CLI files match HEAD.`);
