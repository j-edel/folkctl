# Folk MCP and folkctl

Folk provides a hosted MCP server at **https://mcp.folk.app/mcp**, using Streamable HTTP and OAuth. `folkctl` remains a zero-dependency REST CLI. Its MCP helpers print setup instructions for clients that connect directly to Folk.

## Setup snippets

```bash
folkctl mcp info --json
folkctl mcp config codex
folkctl mcp config claude
folkctl mcp config cursor
folkctl mcp config vscode
folkctl mcp config windsurf
folkctl mcp config generic
```

These commands work offline, never read REST credentials, and never modify client settings. Merge the output into the client's existing configuration. Avoid replacing a config file that contains other servers or settings.

| Client | Output | Authentication |
| --- | --- | --- |
| Codex | TOML stanza for `~/.codex/config.toml` | Run `codex mcp login folk` after merging |
| Claude Code | `claude mcp add --transport http folk https://mcp.folk.app/mcp` | Run the command, then use `/mcp` |
| Cursor | JSON `mcpServers` entry with `url` | Complete the client's OAuth flow |
| VS Code | JSON `servers` entry with `type: http` | Start the server and complete OAuth |
| Windsurf | JSON `mcpServers` entry with `serverUrl` | Complete the client's OAuth flow |
| Generic | JSON `mcpServers` entry with `url` | Use the client's supported configuration format |

`folkctl mcp config <client> --json` returns a JSON envelope with the snippet in `data.content`, its format in `data.format`, and the next step in `data.nextStep`.

For GUI clients that accept a connector URL, enter `https://mcp.folk.app/mcp` and follow their authorization flow. Client UI labels can change; use [Folk's current connection guide](https://developer.folk.app/mcp/connect).

## Authentication boundaries

REST commands authenticate using `FOLK_API_KEY` or the local folkctl config. MCP clients sign in using OAuth and get access according to that Folk account's workspace permissions. An API key is not an MCP OAuth credential. The CLI does not start an MCP server, proxy requests, call MCP tools, or manage OAuth tokens.

## Current capabilities

Folk's [supported-tools reference](https://developer.folk.app/mcp/tools), reviewed September 6, 2026, includes people, companies, custom objects, notes, group structure and membership, interaction history, and Tasks. Use that live catalog for tool names and input schemas; MCP search parameters and pagination differ from the REST CLI's flags and `pagination.nextLink` responses.

The CLI covers the corresponding public REST operations through `people`, `companies`, `objects`, `notes`, `groups`, `interactions`, and `tasks`. Some MCP tools combine operations, such as retrieving workspace structure or toggling task completion, so this is capability coverage rather than a one-to-one MCP implementation.

Interaction history and editing remain in open beta. Imported content may be hidden by workspace privacy rules, and only manually logged interactions can be edited or deleted. See the [MCP overview](https://developer.folk.app/mcp/overview) and [interaction reference](https://developer.folk.app/api-reference/interactions/list-past-interactions).
