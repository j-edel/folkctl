# Publishing a folkctl update

Repository: [j-edel/folkctl](https://github.com/j-edel/folkctl). The CLI and bundled `folk-cli` skill share a major/minor feature release. Skill-only corrections may increment the skill's patch version independently; skill 0.2.1 targets CLI 0.2.0.

## Prepare and verify

1. For CLI releases, update `package.json` and `package-lock.json`. For skill releases, update the `version` in `skills/folk-cli/SKILL.md` and its documented CLI target. CLI version output and the HTTP User-Agent read `package.json` automatically.
2. Update `CHANGELOG.md`, examples, API notes, and the source-backed endpoint fixture if the API changed.
3. Run checks and inspect the package contents:

```bash
npm ci
npm run ci
npm pack --dry-run
node bin/folkctl.js --version
node bin/folkctl.js tasks create --entity-id per_123 --title "Follow up" --due-at 2026-09-08 --is-public=false --dry-run --json
node bin/folkctl.js mcp config codex
```

`npm pack` creates a local installable tarball for testing before publication. Inspect it to ensure it excludes credentials, local configs, and development artifacts. Dry-run and offline tests do not prove live workspace behavior; record live read checks separately when available.

## Release after review

After the change is reviewed and merged, verify the final checkout and CI result before tagging. For 0.2.0:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Use the 0.2.0 changelog entry for GitHub release notes and attach the tested tarball. Verify the GitHub release and installation from its tag.

The public npm registry returned 404 for `folkctl` on September 6, 2026, so npm publication is an optional first publication, not an existing distribution channel. Verify the package name and maintainer account before publishing from the release checkout:

```bash
npm publish --access public
```

If publishing to npm, verify installation with `npm install -g folkctl@0.2.0` and `folkctl --version`. Package publication, a GitHub release, and a ClawHub skill release are separate steps; verify each destination before reporting it published.

## ClawHub companion skill

Use the installed ClawHub CLI's `--help` to confirm its current publish syntax. The release target is the existing `folk-cli` slug and the source is `skills/folk-cli`. Pin both the metadata installer and the manual installation command to the full Git commit SHA of the reviewed CLI release. Verify installation of that exact commit before publishing the skill. Authenticate with the maintainer account and publish the skill's release notes after review.

Verify the owner, latest version, published file checksum, and security result after publication. ClawHub may serve cached metadata or leave a security review pending briefly; an accepted upload does not prove those checks have finished.

MCP setup does not require publishing a second server. `folkctl mcp config` generates snippets for Folk's hosted server; OAuth happens in the user's MCP client.
