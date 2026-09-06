# Publishing a folkctl update

Repository: [j-edel/folkctl](https://github.com/j-edel/folkctl). The CLI and bundled `folk-cli` skill should use the same release version.

## Prepare and verify

1. Update `package.json`, `package-lock.json`, and the `version` in `skills/folk-cli/SKILL.md`. CLI version output and the HTTP User-Agent read `package.json` automatically.
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

Use the installed ClawHub CLI's `--help` to confirm its current publish syntax. The release target is the existing `folk-cli` slug, the source is `skills/folk-cli`, and its version must match the CLI package. Authenticate with the maintainer account and publish the same release notes after review.

MCP setup does not require publishing a second server. `folkctl mcp config` generates snippets for Folk's hosted server; OAuth happens in the user's MCP client.
