# Contributing

Thanks for helping improve `folkctl`.

## Development

```bash
npm install
npm run ci
node bin/folkctl.js --help
node bin/folkctl.js people create --first-name Ada --last-name Lovelace --dry-run --json --pretty
```

## Guidelines

- Keep runtime dependencies at zero unless there is a strong reason.
- Add or update tests for every behavior change.
- Keep `--dry-run` accurate for every mutation.
- Keep stdout machine-readable when `--json` or `--ndjson` is used.
- Never add flags that accept API keys or other secrets directly.
- Prefer new documented folk API fields in `--data` first, then add ergonomic aliases in `src/body.js` once stable.

## Endpoint updates

1. Add the endpoint to `src/endpoints.js`.
2. Add a body helper in `src/body.js` only if it improves ergonomics.
3. Add examples to `README.md` and `skills/folk-cli/SKILL.md`.
4. Add tests.
5. Run `npm run ci`.
