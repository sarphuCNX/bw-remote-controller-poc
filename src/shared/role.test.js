import { ROLES, buildRoleSearch, readRole } from './role';

describe('readRole', () => {
  test('readRole_withPanelParam_returnsPanel', () => {
    const search = '?role=panel';

    const role = readRole(search);

    expect(role).toBe(ROLES.PANEL);
  });

  test('readRole_withWebRoomParamAndNoLeadingQuestionMark_returnsWebRoom', () => {
    const search = 'role=web-room&x=1';

    const role = readRole(search);

    expect(role).toBe(ROLES.WEB_ROOM);
  });

  test('readRole_withUnknownRole_returnsEmptyString', () => {
    const search = '?role=controller';

    const role = readRole(search);

    expect(role).toBe('');
  });

  test('readRole_withNoParam_returnsEmptyString', () => {
    const role = readRole('');

    expect(role).toBe('');
  });
});

describe('buildRoleSearch', () => {
  test('buildRoleSearch_withRole_returnsQueryWithRole', () => {
    const search = buildRoleSearch(ROLES.PANEL);

    expect(search).toBe('?role=panel');
  });

  test('buildRoleSearch_withExistingParams_preservesThemAndOverridesRole', () => {
    const search = buildRoleSearch(ROLES.WEB_ROOM, '?role=panel&debug=1');

    expect(search).toBe('?role=web-room&debug=1');
  });
});
