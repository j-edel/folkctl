import { CliError } from './errors.js';

export const MCP_URL = 'https://mcp.folk.app/mcp';
export const MCP_INFO = {
  url: MCP_URL,
  transport: 'Streamable HTTP',
  authentication: 'OAuth in your MCP client; separate from the REST API key used by folkctl.',
  docsUrl: 'https://developer.folk.app/mcp/overview',
  connectUrl: 'https://developer.folk.app/mcp/connect',
  toolsUrl: 'https://developer.folk.app/mcp/tools',
  capabilities: [
    'People and companies, with bulk create and update of up to 100 records per call',
    'Custom objects, with bulk create and update',
    'Note search',
    'Groups, members and custom fields',
    'Interaction history (folk_list_interactions)',
    'Tasks and completion',
    'Person enrichments and credits',
  ],
  notes: [
    'Records cannot be deleted through the MCP.',
    'Single-record create and update tools for people, companies and objects are deprecated in favor of the bulk tools and will be removed on April 16, 2027.',
  ],
  cli: 'folkctl mcp config prints setup snippets. It does not run an MCP server, call MCP tools, or authenticate a client.',
};

export function mcpConfig(client) {
  const result = { client, authentication: 'OAuth', docsUrl: MCP_INFO.connectUrl };
  if (client === 'codex') {
    return { ...result, format: 'toml', content: `[mcp_servers.folk]\nurl = "${MCP_URL}"`, nextStep: 'Merge into ~/.codex/config.toml, then run codex mcp login folk.' };
  }
  if (client === 'claude' || client === 'claude-code') {
    return { ...result, format: 'shell', content: `claude mcp add --transport http folk ${MCP_URL}`, nextStep: 'Run the command, then use /mcp in Claude Code to complete OAuth.' };
  }
  let config;
  if (client === 'generic' || client === 'cursor') config = { mcpServers: { folk: { url: MCP_URL } } };
  else if (client === 'vscode') config = { servers: { folk: { type: 'http', url: MCP_URL } } };
  else if (client === 'windsurf') config = { mcpServers: { folk: { serverUrl: MCP_URL } } };
  else throw new CliError(`Unknown MCP client: ${client}. Choose generic, codex, claude, cursor, vscode, or windsurf.`, { exitCode: 2 });
  return { ...result, format: 'json', content: JSON.stringify(config, null, 2), nextStep: 'Merge this snippet into your MCP client configuration, then complete its OAuth flow.' };
}
