export const DOCS_BASE = 'https://developer.folk.app/api-reference';

export const ENDPOINTS = [
  endpoint('people.list', 'GET', '/v1/people', 'List people', 'people/list-people', { paginated: true, filters: true }),
  endpoint('people.create', 'POST', '/v1/people', 'Create a person', 'people/create-a-person'),
  endpoint('people.get', 'GET', '/v1/people/{personId}', 'Get a person', 'people/get-a-person'),
  endpoint('people.update', 'PATCH', '/v1/people/{personId}', 'Update a person', 'people/update-a-person'),
  endpoint('people.delete', 'DELETE', '/v1/people/{personId}', 'Delete a person', 'people/delete-a-person', { destructive: true }),

  endpoint('companies.list', 'GET', '/v1/companies', 'List companies', 'companies/list-companies', { paginated: true, filters: true }),
  endpoint('companies.create', 'POST', '/v1/companies', 'Create a company', 'companies/create-a-company'),
  endpoint('companies.get', 'GET', '/v1/companies/{companyId}', 'Get a company', 'companies/get-a-company'),
  endpoint('companies.update', 'PATCH', '/v1/companies/{companyId}', 'Update a company', 'companies/update-a-company'),
  endpoint('companies.delete', 'DELETE', '/v1/companies/{companyId}', 'Delete a company', 'companies/delete-a-company', { destructive: true }),

  endpoint('deals.list', 'GET', '/v1/groups/{groupId}/{objectType}', 'List deals', 'deals/list-deals', { paginated: true, filters: true }),
  endpoint('deals.create', 'POST', '/v1/groups/{groupId}/{objectType}', 'Create a deal', 'deals/create-a-deal'),
  endpoint('deals.get', 'GET', '/v1/groups/{groupId}/{objectType}/{dealId}', 'Get a deal', 'deals/get-a-deal'),
  endpoint('deals.update', 'PATCH', '/v1/groups/{groupId}/{objectType}/{dealId}', 'Update a deal', 'deals/update-a-deal'),
  endpoint('deals.delete', 'DELETE', '/v1/groups/{groupId}/{objectType}/{dealId}', 'Delete a deal', 'deals/delete-a-deal', { destructive: true }),

  endpoint('groups.list', 'GET', '/v1/groups', 'List groups', 'groups/list-groups', { paginated: true }),
  endpoint('groups.fields', 'GET', '/v1/groups/{groupId}/custom-fields/{entityType}', 'List group custom fields', 'groups/list-group-custom-fields', { paginated: true }),

  endpoint('users.list', 'GET', '/v1/users', 'List users', 'users/list-users', { paginated: true }),
  endpoint('users.me', 'GET', '/v1/users/me', 'Get the current user', 'users/get-the-current-user'),
  endpoint('users.get', 'GET', '/v1/users/{userId}', 'Get a user', 'users/get-a-user'),

  endpoint('notes.list', 'GET', '/v1/notes', 'List notes', 'notes/list-notes', { paginated: true }),
  endpoint('notes.create', 'POST', '/v1/notes', 'Create a note', 'notes/create-a-note'),
  endpoint('notes.get', 'GET', '/v1/notes/{noteId}', 'Get a note', 'notes/get-a-note'),
  endpoint('notes.update', 'PATCH', '/v1/notes/{noteId}', 'Update a note', 'notes/update-a-note'),
  endpoint('notes.delete', 'DELETE', '/v1/notes/{noteId}', 'Delete a note', 'notes/delete-a-note', { destructive: true }),

  endpoint('reminders.list', 'GET', '/v1/reminders', 'List reminders', 'reminders/list-reminders', { paginated: true }),
  endpoint('reminders.create', 'POST', '/v1/reminders', 'Create a reminder', 'reminders/create-a-reminder'),
  endpoint('reminders.get', 'GET', '/v1/reminders/{reminderId}', 'Get a reminder', 'reminders/get-a-reminder'),
  endpoint('reminders.update', 'PATCH', '/v1/reminders/{reminderId}', 'Update a reminder', 'reminders/update-a-reminder'),
  endpoint('reminders.delete', 'DELETE', '/v1/reminders/{reminderId}', 'Delete a reminder', 'reminders/delete-a-reminder', { destructive: true }),

  endpoint('interactions.create', 'POST', '/v1/interactions', 'Create an interaction', 'interactions/create-an-interaction'),

  endpoint('webhooks.list', 'GET', '/v1/webhooks', 'List webhooks', 'webhooks/list-webhooks', { paginated: true }),
  endpoint('webhooks.create', 'POST', '/v1/webhooks', 'Create a webhook', 'webhooks/create-a-webhook'),
  endpoint('webhooks.get', 'GET', '/v1/webhooks/{webhookId}', 'Get a webhook', 'webhooks/get-a-webhook'),
  endpoint('webhooks.update', 'PATCH', '/v1/webhooks/{webhookId}', 'Update a webhook', 'webhooks/update-a-webhook'),
  endpoint('webhooks.delete', 'DELETE', '/v1/webhooks/{webhookId}', 'Delete a webhook', 'webhooks/delete-a-webhook', { destructive: true }),
];

function endpoint(key, method, path, summary, docsPath, extra = {}) {
  const [resource, action] = key.split('.');
  return {
    key,
    resource,
    action,
    method,
    path,
    summary,
    docsUrl: `${DOCS_BASE}/${docsPath}`,
    ...extra,
  };
}

export function findEndpoint(key) {
  return ENDPOINTS.find((endpoint) => endpoint.key === key);
}

export function listEndpoints({ resource } = {}) {
  return resource ? ENDPOINTS.filter((endpoint) => endpoint.resource === resource) : ENDPOINTS;
}

export function fillPath(template, params = {}) {
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') throw new Error(`Missing path parameter: ${name}`);
    return encodeURIComponent(String(value));
  });
}
