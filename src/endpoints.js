export const DOCS_BASE = 'https://developer.folk.app/api-reference';
export const REMINDERS_DEPRECATION = 'Reminders are deprecated. Use tasks instead; Folk lists February 13, 2027 as the sunset date.';

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

  endpoint('objects.list', 'GET', '/v1/groups/{groupId}/{objectType}', 'List custom objects', 'custom-objects/list-objects', { paginated: true, filters: true }),
  endpoint('objects.create', 'POST', '/v1/groups/{groupId}/{objectType}', 'Create a custom object', 'custom-objects/create-an-object'),
  endpoint('objects.get', 'GET', '/v1/groups/{groupId}/{objectType}/{objectId}', 'Get a custom object', 'custom-objects/get-an-object'),
  endpoint('objects.update', 'PATCH', '/v1/groups/{groupId}/{objectType}/{objectId}', 'Update a custom object', 'custom-objects/update-an-object'),
  endpoint('objects.delete', 'DELETE', '/v1/groups/{groupId}/{objectType}/{objectId}', 'Delete a custom object', 'custom-objects/delete-an-object', { destructive: true }),

  endpoint('groups.list', 'GET', '/v1/groups', 'List groups', 'groups/list-groups', { paginated: true }),
  endpoint('groups.create', 'POST', '/v1/groups', 'Create a group', 'groups/create-a-group'),
  endpoint('groups.update', 'PATCH', '/v1/groups/{groupId}', 'Update a group', 'groups/update-a-group'),
  endpoint('groups.fields', 'GET', '/v1/groups/{groupId}/custom-fields/{entityType}', 'List group custom fields (legacy key)', 'group-custom-fields/list-group-custom-fields', { paginated: true, aliasFor: 'groups.fields.list' }),
  endpoint('groups.fields.list', 'GET', '/v1/groups/{groupId}/custom-fields/{entityType}', 'List group custom fields', 'group-custom-fields/list-group-custom-fields', { paginated: true }),
  endpoint('groups.fields.create', 'POST', '/v1/groups/{groupId}/custom-fields/{entityType}', 'Create a group custom field', 'group-custom-fields/create-a-group-custom-field'),
  endpoint('groups.fields.get', 'GET', '/v1/groups/{groupId}/custom-fields/{entityType}/{customFieldName}', 'Get a group custom field', 'group-custom-fields/get-a-group-custom-field'),
  endpoint('groups.fields.update', 'PATCH', '/v1/groups/{groupId}/custom-fields/{entityType}/{customFieldName}', 'Update a group custom field', 'group-custom-fields/update-a-group-custom-field'),
  endpoint('groups.members.list', 'GET', '/v1/groups/{groupId}/members', 'List group members', 'group-members/list-group-members', { paginated: true }),
  endpoint('groups.members.add', 'POST', '/v1/groups/{groupId}/members', 'Add a group member', 'group-members/add-a-group-member'),
  endpoint('groups.members.update', 'PATCH', '/v1/groups/{groupId}/members/{userId}', 'Update a group member role', 'group-members/update-a-group-member'),
  endpoint('groups.members.remove', 'DELETE', '/v1/groups/{groupId}/members/{userId}', 'Remove a group member', 'group-members/remove-a-group-member', { destructive: true }),

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

  endpoint('tasks.list', 'GET', '/v1/tasks', 'List tasks', 'tasks/list-tasks', { paginated: true, filters: true }),
  endpoint('tasks.create', 'POST', '/v1/tasks', 'Create a task', 'tasks/create-a-task'),
  endpoint('tasks.get', 'GET', '/v1/tasks/{taskId}', 'Get a task', 'tasks/get-a-task'),
  endpoint('tasks.update', 'PATCH', '/v1/tasks/{taskId}', 'Update a task', 'tasks/update-a-task'),
  endpoint('tasks.delete', 'DELETE', '/v1/tasks/{taskId}', 'Delete a task', 'tasks/delete-a-task', { destructive: true }),
  endpoint('tasks.done', 'POST', '/v1/tasks/{taskId}/mark-as-done', 'Mark a task as done', 'tasks/mark-a-task-as-done'),
  endpoint('tasks.todo', 'POST', '/v1/tasks/{taskId}/mark-as-todo', 'Mark a task as to do', 'tasks/mark-a-task-as-to-do'),

  endpoint('interactions.create', 'POST', '/v1/interactions', 'Create an interaction', 'interactions/create-an-interaction'),
  endpoint('interactions.past', 'GET', '/v1/interactions/past', 'List past interactions', 'interactions/list-past-interactions', { paginated: true, beta: true, requiredQuery: ['entity.id'] }),
  endpoint('interactions.upcoming', 'GET', '/v1/interactions/upcoming', 'List upcoming interactions', 'interactions/list-upcoming-interactions', { paginated: true, beta: true, requiredQuery: ['entity.id'] }),
  endpoint('interactions.get', 'GET', '/v1/interactions/{interactionId}', 'Get a past or upcoming interaction', 'interactions/get-a-past-or-upcoming-interaction', { beta: true, requiredQuery: ['entity.id'] }),
  endpoint('interactions.update', 'PATCH', '/v1/interactions/{interactionId}', 'Update a logged interaction', 'interactions/update-an-interaction', { beta: true }),
  endpoint('interactions.delete', 'DELETE', '/v1/interactions/{interactionId}', 'Delete a logged interaction', 'interactions/delete-an-interaction', { destructive: true, beta: true, requiredQuery: ['entity.id'] }),

  endpoint('webhooks.list', 'GET', '/v1/webhooks', 'List webhooks', 'webhooks/list-webhooks', { paginated: true }),
  endpoint('webhooks.create', 'POST', '/v1/webhooks', 'Create a webhook', 'webhooks/create-a-webhook'),
  endpoint('webhooks.get', 'GET', '/v1/webhooks/{webhookId}', 'Get a webhook', 'webhooks/get-a-webhook'),
  endpoint('webhooks.update', 'PATCH', '/v1/webhooks/{webhookId}', 'Update a webhook', 'webhooks/update-a-webhook'),
  endpoint('webhooks.delete', 'DELETE', '/v1/webhooks/{webhookId}', 'Delete a webhook', 'webhooks/delete-a-webhook', { destructive: true }),
];

function endpoint(key, method, path, summary, docsPath, extra = {}) {
  const [resource, ...actions] = key.split('.');
  return {
    key,
    resource,
    action: actions.join('.'),
    method,
    path,
    summary,
    docsUrl: `${DOCS_BASE}/${docsPath}`,
    ...(resource === 'reminders' ? { deprecated: true, deprecation: REMINDERS_DEPRECATION, sunset: '2027-02-13' } : {}),
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
