import React from 'react';
import { ROLES, buildRoleSearch, readRole } from './shared/role';
import PanelRole from './roles/panel/PanelRole';
import WebRoomRole from './roles/web-room/WebRoomRole';

/**
 * Role selector shown when the URL carries no role. Picking a role navigates
 * to the same page with `?role=...` so the choice is pinned per tab.
 * @returns {JSX.Element} the selector
 */
const RoleSelector = () => {
  const choose = (role) => {
    window.location.search = buildRoleSearch(role, window.location.search);
  };
  return (
    <div className="selector" data-testid="role-selector">
      <h1>BirdAI Remote Control POC</h1>
      <p>Open this page twice: one tab as the Panel, another as the Web room.</p>
      <div className="selector-buttons">
        <button type="button" onClick={() => choose(ROLES.PANEL)} data-testid="choose-panel">
          Panel (device simulator)
        </button>
        <button type="button" onClick={() => choose(ROLES.WEB_ROOM)} data-testid="choose-web-room">
          Web room (controller)
        </button>
      </div>
    </div>
  );
};

/**
 * Routes the tab to its role.
 * @returns {JSX.Element} the role screen
 */
const App = () => {
  const role = readRole(typeof window !== 'undefined' ? window.location.search : '');
  if (role === ROLES.PANEL) return <PanelRole />;
  if (role === ROLES.WEB_ROOM) return <WebRoomRole />;
  return <RoleSelector />;
};

export default App;
