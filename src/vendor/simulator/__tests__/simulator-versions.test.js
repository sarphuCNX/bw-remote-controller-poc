import {
  SIMULATOR_VERSIONS,
  SIMULATOR_VERSION_IDS,
  DEFAULT_VERSION_ID,
  getVersion,
  isKnownVersion,
} from '../core/simulator-versions';

describe('simulator versions registry', () => {
  test('exposes the v1, v2, and v3 versions', () => {
    expect(SIMULATOR_VERSIONS.map((v) => v.id)).toEqual([
      SIMULATOR_VERSION_IDS.V1,
      SIMULATOR_VERSION_IDS.V2,
      SIMULATOR_VERSION_IDS.V3,
    ]);
  });

  test('every version has a label, a description, and behavior flags', () => {
    for (const version of SIMULATOR_VERSIONS) {
      expect(typeof version.label).toBe('string');
      expect(version.description.length).toBeGreaterThan(0);
      expect(typeof version.behavior.advertiseShowPin).toBe('boolean');
      expect(typeof version.behavior.reportRoomCode).toBe('boolean');
      expect(typeof version.behavior.registerWithToken).toBe('boolean');
    }
  });

  test('v1 reports the room code and advertises the cast PIN', () => {
    expect(getVersion('v1').behavior).toEqual({
      advertiseShowPin: true,
      reportRoomCode: true,
      registerWithToken: false,
    });
  });

  test('v2 does neither — pairing grant is the authorization', () => {
    expect(getVersion('v2').behavior).toEqual({
      advertiseShowPin: false,
      reportRoomCode: false,
      registerWithToken: false,
    });
  });

  test('v3 registers with a per-device token, no room code or PIN', () => {
    expect(getVersion('v3').behavior).toEqual({
      advertiseShowPin: false,
      reportRoomCode: false,
      registerWithToken: true,
    });
  });

  test('the default version is v1', () => {
    expect(DEFAULT_VERSION_ID).toBe('v1');
  });
});

describe('getVersion / isKnownVersion', () => {
  test('getVersion returns the requested version', () => {
    expect(getVersion('v2').id).toBe('v2');
  });

  test('getVersion falls back to the default for an unknown id', () => {
    expect(getVersion('v999').id).toBe(DEFAULT_VERSION_ID);
  });

  test('getVersion falls back to the default for a missing id', () => {
    expect(getVersion(undefined).id).toBe(DEFAULT_VERSION_ID);
  });

  test('isKnownVersion distinguishes known from unknown ids', () => {
    expect(isKnownVersion('v1')).toBe(true);
    expect(isKnownVersion('v2')).toBe(true);
    expect(isKnownVersion('nope')).toBe(false);
    expect(isKnownVersion(undefined)).toBe(false);
  });
});
