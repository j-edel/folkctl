export const VERSION = '0.1.0';

export function topHelp() {
  return `folkctl ${VERSION}

Zero-dependency CLI for the folk.app API, designed to be driven by humans or OpenClaw skills.

Usage:
  folkctl <resource> <action> [args] [flags]
  folkctl api <ls|docs|spec|request> [...]
  folkctl auth <login|logout|status> [flags]

Resources:
  people       list, search, get, create, update, delete
  companies    list, search, get, create, update, delete
  deals        list, search, get, create, update, delete
  groups       list, fields
  users        list, me, get
  notes        list, get, create, update, delete
  reminders    list, get, create, update, delete
  interactions create
  webhooks     list, get, create, update, delete

Global flags:
  --json                 Machine-readable JSON output
  --pretty               Pretty-print JSON output
  --ndjson               Newline-delimited JSON for list items
  --plain                Print only the best identifier/name per item
  --csv                  CSV output for flat list fields
  --dry-run              Print the HTTP request without sending it
  --all                  Follow pagination.nextLink and merge all pages
  --limit <n>            Items per page where supported
  --filter f:op:v        Add folk filter[f][op]=v
  --param key=value      Add a raw query parameter
  --api-version <date>   Set X-API-Version for this call
  --base-url <url>       Override https://api.folk.app
  --config <path>        Override config path
  --no-input             Never prompt; fail instead
  --yes, --force         Skip destructive confirmations

Auth:
  export FOLK_API_KEY=fk_live_...
  printf '%s' "$FOLK_API_KEY" | folkctl auth login --token-stdin

Examples:
  folkctl people list --limit 20
  folkctl people search "Ada Lovelace" --json
  folkctl people create --first-name Ada --last-name Lovelace --email ada@example.com --group-id grp_...
  folkctl companies list --filter name:like:OpenAI --json
  folkctl groups fields grp_... person
  folkctl deals list --group-id grp_... --object-type Deals
  folkctl notes create --entity-id per_... --content "Met at SaaStr." --visibility private
  folkctl api docs people.create
  folkctl api request GET /v1/users/me --json
`;
}

export function resourceHelp(resource) {
  const common = `Usage:
  folkctl ${resource} list [--limit n] [--all] [--filter f:op:v] [--json]
  folkctl ${resource} get <id> [--json]
  folkctl ${resource} create [fields|--data JSON|--data @file|-] [--dry-run]
  folkctl ${resource} update <id> [fields|--data JSON|--data @file|-] [--dry-run]
  folkctl ${resource} delete <id> [--yes|--force] [--dry-run]

Filtering:
  --filter fullName:like:Ada       -> filter[fullName][like]=Ada
  --filter groups:in:id:grp_...    -> filter[groups][in][id]=grp_...
  --filter emails:like:@folk.app   -> filter[emails][like]=@folk.app
  --empty description              -> filter[description][empty]
  --combinator or                  -> combine filters with OR
`;
  const extras = {
    people: `People fields:
  --first-name Ada --last-name Lovelace --full-name "Ada Lovelace"
  --email ada@example.com --phone +15551234567 --url https://example.com
  --group-id grp_... --company-id com_...
  --custom grp_...\.Status=Active
`,
    companies: `Company fields:
  --name "Acme Inc" --email hello@acme.com --url https://acme.com
  --group-id grp_... --custom grp_...\.Stage=Lead
`,
    notes: `Note fields:
  --entity-id per_... --content "Markdown content" --visibility public|private
`,
    reminders: `Reminder fields:
  --entity-id per_... --name "Follow up" --recurrence-rule "DTSTART...\nRRULE:FREQ=WEEKLY"
  --assigned-user-id usr_... --assigned-user-email jane@example.com
`,
    webhooks: `Webhook fields:
  --name "My app" --target-url https://example.com/webhook
  --event person.created --event company.updated:grp_...
`,
  };
  return `${common}\n${extras[resource] || ''}`;
}

export function dealsHelp() {
  return `Usage:
  folkctl deals list --group-id grp_... --object-type Deals [--limit n] [--all]
  folkctl deals search "Project Alpha" --group-id grp_... --object-type Deals
  folkctl deals get <dealId> --group-id grp_... --object-type Deals
  folkctl deals create --group-id grp_... --object-type Deals --name "Project Alpha"
  folkctl deals update <dealId> --group-id grp_... --object-type Deals --custom Status=Won
  folkctl deals delete <dealId> --group-id grp_... --object-type Deals --yes

The folk API uses /v1/groups/{groupId}/{objectType}; objectType is the name of the deal custom field retrieved from group custom fields.
`;
}

export function apiHelp() {
  return `Usage:
  folkctl api ls [resource]
  folkctl api docs <endpoint-key>
  folkctl api spec <endpoint-key>
  folkctl api request <METHOD> <PATH-OR-URL> [--param k=v] [--data JSON] [--json]

Examples:
  folkctl api ls people
  folkctl api docs people.create
  folkctl api request GET /v1/users/me --json
  folkctl api request POST /v1/people --data '{"firstName":"Ada","lastName":"Lovelace"}' --dry-run
`;
}

export function authHelp() {
  return `Usage:
  folkctl auth status [--check]
  folkctl auth login --token-stdin
  folkctl auth logout

Prefer FOLK_API_KEY for automation. auth login stores a local config file with 0600 permissions where supported.
`;
}
