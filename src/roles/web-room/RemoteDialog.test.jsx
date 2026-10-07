import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RemoteDialog } from './RemoteDialog';

// jsdom may lack PointerEvent; React only needs the event type plus the
// pointer fields, so a MouseEvent subclass carrying them is enough.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  };
}

/**
 * Renders the dialog over a recording pipeline.
 * @returns {{pipeline: object, pad: HTMLElement}} the harness
 */
function renderDialog({ heldButtons = 0 } = {}) {
  const pipeline = {
    move: vi.fn(),
    scroll: vi.fn(),
    button: vi.fn(),
    click: vi.fn(),
    key: vi.fn(),
    releaseAll: vi.fn(),
    heldButtons: vi.fn(() => heldButtons),
  };
  render(<RemoteDialog getPipeline={() => pipeline} onClose={() => {}} statusLine="test" />);
  return { pipeline, pad: screen.getByTestId('remote-pad') };
}

const mouse = (overrides) => ({ pointerId: 1, pointerType: 'mouse', button: 0, ...overrides });

/**
 * Builds a native pointermove event whose coalesced-sample list is scripted.
 * @param {{clientX: number, clientY: number}} init - the event position
 * @param {Array<{clientX: number, clientY: number}>|undefined} coalesced - samples, or undefined for no API
 * @returns {{event: Event, getCoalescedEvents: object|undefined}} the event and the spy
 */
function nativePointerMove(init, coalesced) {
  const event = new window.PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', ...init });
  if (coalesced === undefined) return { event, getCoalescedEvents: undefined };
  const getCoalescedEvents = vi.fn(() => coalesced);
  event.getCoalescedEvents = getCoalescedEvents;
  return { event, getCoalescedEvents };
}

describe('RemoteDialog mouse handling', () => {
  test('mouseMove_withoutButtonHeld_movesByDeltaFromPreviousSample', () => {
    const { pipeline, pad } = renderDialog();

    fireEvent.pointerMove(pad, mouse({ clientX: 10, clientY: 10 }));
    fireEvent.pointerMove(pad, mouse({ clientX: 15, clientY: 12 }));

    expect(pipeline.move).toHaveBeenCalledTimes(1);
    expect(pipeline.move).toHaveBeenCalledWith(5, 2);
  });

  test('mouseDown_thenMove_thenUp_sendsButtonAroundTheMove', () => {
    const { pipeline, pad } = renderDialog();

    fireEvent.pointerDown(pad, mouse({ clientX: 0, clientY: 0 }));
    fireEvent.pointerMove(pad, mouse({ clientX: 3, clientY: 4 }));
    fireEvent.pointerUp(pad, mouse({ clientX: 3, clientY: 4 }));

    expect(pipeline.button).toHaveBeenNthCalledWith(1, 0, true);
    expect(pipeline.move).toHaveBeenCalledWith(3, 4);
    expect(pipeline.button).toHaveBeenNthCalledWith(2, 0, false);
  });

  test('pointerLeave_releasesAllButtonsInsteadOfSendingButtonMinusOne', () => {
    const { pipeline, pad } = renderDialog();
    fireEvent.pointerDown(pad, mouse({ clientX: 0, clientY: 0 }));

    fireEvent.pointerLeave(pad, mouse({ clientX: -5, clientY: 0, button: -1 }));

    expect(pipeline.releaseAll).toHaveBeenCalled();
    expect(pipeline.button).not.toHaveBeenCalledWith(-1, false);
  });

  test('mouseLeave_whileOnlyHovering_doesNotReleaseButtons', () => {
    const { pipeline, pad } = renderDialog();
    fireEvent.pointerMove(pad, mouse({ clientX: 10, clientY: 10 }));

    fireEvent.pointerLeave(pad, mouse({ clientX: -1, clientY: 10, button: -1 }));

    expect(pipeline.releaseAll).not.toHaveBeenCalled();
  });

  test('mouseLeave_whileAButtonIsHeldFromTheOnScreenButton_releasesAll', () => {
    const LEFT_HELD = 1;
    const { pipeline, pad } = renderDialog({ heldButtons: LEFT_HELD });
    fireEvent.pointerMove(pad, mouse({ clientX: 10, clientY: 10 }));

    fireEvent.pointerLeave(pad, mouse({ clientX: -1, clientY: 10, button: -1 }));

    expect(pipeline.releaseAll).toHaveBeenCalledTimes(1);
  });

  test('mouseMove_withCoalescedSamples_sumsDeltasAndReadsTheListOnce', () => {
    const { pipeline, pad } = renderDialog();
    fireEvent.pointerMove(pad, mouse({ clientX: 10, clientY: 10 }));
    const { event, getCoalescedEvents } = nativePointerMove({ clientX: 15, clientY: 13 }, [
      { clientX: 12, clientY: 10 },
      { clientX: 15, clientY: 13 },
    ]);

    fireEvent(pad, event);

    expect(pipeline.move).toHaveBeenCalledWith(5, 3);
    expect(getCoalescedEvents).toHaveBeenCalledTimes(1);
  });

  test('mouseMove_withEmptyCoalescedList_fallsBackToTheEventItself', () => {
    const { pipeline, pad } = renderDialog();
    fireEvent.pointerMove(pad, mouse({ clientX: 10, clientY: 10 }));
    const { event } = nativePointerMove({ clientX: 14, clientY: 11 }, []);

    fireEvent(pad, event);

    expect(pipeline.move).toHaveBeenCalledWith(4, 1);
  });

  test('mouseMove_withoutCoalescedEventsApi_usesTheEventItself', () => {
    const { pipeline, pad } = renderDialog();
    fireEvent.pointerMove(pad, mouse({ clientX: 10, clientY: 10 }));
    const { event } = nativePointerMove({ clientX: 16, clientY: 10 }, undefined);

    fireEvent(pad, event);

    expect(pipeline.move).toHaveBeenCalledWith(6, 0);
  });

  test('touchLift_doesNotReleaseAButtonHeldOnScreen', () => {
    const { pipeline, pad } = renderDialog();
    const touch = (overrides) => ({ pointerId: 7, pointerType: 'touch', ...overrides });
    fireEvent.pointerDown(pad, touch({ clientX: 10, clientY: 10 }));
    fireEvent.pointerUp(pad, touch({ clientX: 20, clientY: 10 }));

    fireEvent.pointerLeave(pad, touch({ clientX: 20, clientY: 10 }));

    expect(pipeline.releaseAll).not.toHaveBeenCalled();
    expect(pipeline.button).not.toHaveBeenCalled();
  });

  test('wheel_sendsScrollDeltas', () => {
    const { pipeline, pad } = renderDialog();

    fireEvent.wheel(pad, { deltaX: 0, deltaY: 120 });

    expect(pipeline.scroll).toHaveBeenCalledWith(0, 120);
  });

  test('keyDown_thenKeyUp_sendsBothWithRepeatFiltered', () => {
    const { pipeline, pad } = renderDialog();

    fireEvent.keyDown(pad, { key: 'a', code: 'KeyA' });
    fireEvent.keyDown(pad, { key: 'a', code: 'KeyA', repeat: true });
    fireEvent.keyUp(pad, { key: 'a', code: 'KeyA' });

    expect(pipeline.key).toHaveBeenCalledTimes(2);
    expect(pipeline.key.mock.calls[0][0]).toMatchObject({ key: 'a', down: true });
    expect(pipeline.key.mock.calls[1][0]).toMatchObject({ key: 'a', down: false });
  });

  test('touchMove_withoutTouchStartOnPad_isIgnored', () => {
    const { pipeline, pad } = renderDialog();

    fireEvent.pointerMove(pad, { pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(pad, { pointerId: 7, pointerType: 'touch', clientX: 20, clientY: 10 });

    expect(pipeline.move).not.toHaveBeenCalled();
  });
});
