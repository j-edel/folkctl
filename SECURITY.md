# Security policy

`folkctl` works with CRM data and API keys. Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/j-edel/folkctl/security/advisories/new).

## Secret handling

- Use `FOLK_API_KEY` or `folkctl auth login --token-stdin`.
- Do not pass API keys as flags or positional arguments.
- `--dry-run` redacts the Authorization header.
- Config files are written with `0600` permissions where supported.
