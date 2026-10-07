import { applyV1Payload, extractV1Payload } from './v1-apply';

const SURFACE = { width: 1000, height: 500 };

describe('extractV1Payload', () => {
  test('extract_fromForwardedServerEvent_returnsAdditionalParameters', () => {
    const event = { message: 'Start Meeting', data: { meetingCommand: 'REMOTE_CONTROL', additionalParameters: { type: 'WHEEL', x: 0, y: 1 } } };

    expect(extractV1Payload(event)).toEqual({ type: 'WHEEL', x: 0, y: 1 });
  });

  test('extract_fromAlreadyUnwrappedPayload_returnsIt', () => {
    expect(extractV1Payload({ type: 'MOUSE_UP' })).toEqual({ type: 'MOUSE_UP' });
  });

  test('extract_fromGarbage_returnsNull', () => {
    expect(extractV1Payload({ data: 'nope' })).toBeNull();
  });
});

describe('applyV1Payload', () => {
  test('mouseMove_withNormalizedCoordinates_setsAbsoluteCursor', () => {
    const cursor = { x: 0, y: 0, buttons: 0 };

    const result = applyV1Payload({ type: 'MOUSE_MOVE', x: 0.25, y: 0.5 }, cursor, SURFACE);

    expect(result.kind).toBe('move');
    expect(cursor).toMatchObject({ x: 250, y: 250 });
  });

  test('mouseMove_withOutOfRangeCoordinates_clamps', () => {
    const cursor = { x: 0, y: 0, buttons: 0 };

    applyV1Payload({ type: 'MOUSE_MOVE', x: -1, y: 2 }, cursor, SURFACE);

    expect(cursor).toMatchObject({ x: 0, y: 500 });
  });

  test('mouseDownThenUp_togglesLeftButtonBit', () => {
    const cursor = { x: 0, y: 0, buttons: 0 };

    applyV1Payload({ type: 'MOUSE_DOWN' }, cursor, SURFACE);
    expect(cursor.buttons).toBe(1);
    applyV1Payload({ type: 'MOUSE_UP' }, cursor, SURFACE);

    expect(cursor.buttons).toBe(0);
  });

  test('keyboardPress_returnsKeyEventWithModifiers', () => {
    const result = applyV1Payload({ type: 'KEYBOARD_PRESS', key: 'a', ctrlKey: true }, { x: 0, y: 0, buttons: 0 }, SURFACE);

    expect(result).toEqual({ kind: 'key', event: { key: 'a', mods: { ctrl: true, alt: false, shift: false, meta: false } } });
  });

  test('unknownType_isIgnored', () => {
    expect(applyV1Payload({ type: 'SOMETHING' }, { x: 0, y: 0, buttons: 0 }, SURFACE)).toEqual({ kind: 'ignored' });
  });
});
