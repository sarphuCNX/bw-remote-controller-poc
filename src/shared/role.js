// Tab role — which half of the POC a browser tab plays. The role lives in the
// URL (never in localStorage) so two tabs on the same origin can never clash:
// Tab A opens `?role=panel`, Tab B opens `?role=web-room`.

export const ROLES = Object.freeze({
  PANEL: 'panel',
  WEB_ROOM: 'web-room',
});

const ROLE_PARAM = 'role';

/**
 * Reads the tab role from a query string.
 * @param {string} search - `window.location.search` (with or without the leading `?`)
 * @returns {string} a known role, or '' when absent or unknown
 */
export function readRole(search) {
  const params = new URLSearchParams(String(search || ''));
  const value = params.get(ROLE_PARAM);
  return Object.values(ROLES).includes(value) ? value : '';
}

/**
 * Builds the URL (search part) that pins a role for a tab.
 * @param {string} role - one of ROLES
 * @param {string} [search] - existing query string to preserve other params
 * @returns {string} the query string including the leading `?`
 */
export function buildRoleSearch(role, search = '') {
  const params = new URLSearchParams(String(search || ''));
  params.set(ROLE_PARAM, role);
  return `?${params.toString()}`;
}
