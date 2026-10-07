import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import DeviceSimulator from '../components/DeviceSimulator';
import { createBirdDevice } from '../core/bird-device-core';
import { createPanelReceiver } from '../core/panel-receiver-core';

vi.mock('../core/bird-device-core');
vi.mock('../core/panel-receiver-core');

/** Captures the callbacks/options passed to each core so tests can drive them. */
let birdCallbacks;
let panelCallbacks;
let panelOptions;
let birdDevice;
let panelReceiver;

beforeEach(() => {
  window.localStorage.clear();
  birdCallbacks = null;
  panelCallbacks = null;
  panelOptions = null;
  birdDevice = {
    goLive: vi.fn().mockResolvedValue('ABC12'),
    stop: vi.fn(),
    reportCymcastRoomCode: vi.fn(),
    fetchCymcastReceiverToken: vi.fn().mockResolvedValue('receiver-token'),
  };
  panelReceiver = { start: vi.fn(), stop: vi.fn(), dropSocket: vi.fn(), getState: vi.fn() };
  createBirdDevice.mockImplementation(({ callbacks }) => {
    birdCallbacks = callbacks;
    return birdDevice;
  });
  createPanelReceiver.mockImplementation((options) => {
    panelOptions = options;
    panelCallbacks = options.callbacks;
    return panelReceiver;
  });
});

/**
 * Renders the simulator and fills in a valid config so Go live is enabled.
 * @returns {import('@testing-library/react').RenderResult} render result
 */
const renderReady = () => {
  const utils = render(<DeviceSimulator />);
  fireEvent.change(utils.getByTestId('simulator-config-birdUrl'), {
    target: { value: 'https://bird.test' },
  });
  fireEvent.change(utils.getByTestId('simulator-config-cymcastUrl'), {
    target: { value: 'http://localhost:8787' },
  });
  fireEvent.change(utils.getByTestId('simulator-config-panelSecret'), {
    target: { value: 'dev' },
  });
  return utils;
};

describe('DeviceSimulator config gating', () => {
  test('Go live is disabled until the required config is filled', () => {
    window.localStorage.clear();
    const { getByTestId } = render(<DeviceSimulator />);

    // Config seeds bird/cymcast urls from dashboard config but not the panel secret.
    fireEvent.change(getByTestId('simulator-config-panelSecret'), { target: { value: '' } });

    expect(getByTestId('simulator-go-live')).toBeDisabled();
  });

  test('Go live enables once url + secret are present', () => {
    const { getByTestId } = renderReady();

    expect(getByTestId('simulator-go-live')).not.toBeDisabled();
  });

  test('config edits persist to localStorage', () => {
    renderReady();

    expect(window.localStorage.getItem('cymcast.deviceSimulator.v1')).toContain('localhost:8787');
  });
});

describe('DeviceSimulator go live', () => {
  test('going live shows the device code from the bird core', async () => {
    const { getByTestId } = renderReady();

    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    expect(getByTestId('simulator-device-code')).toHaveTextContent('ABC12');
  });

  test('the panel receiver is started after go live', async () => {
    const { getByTestId } = renderReady();

    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    expect(panelReceiver.start).toHaveBeenCalled();
  });

  test('the panel registers with panelId = hardwareId and no requestedCode', async () => {
    const { getByTestId } = renderReady();

    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    const storedHardwareId = JSON.parse(
      window.localStorage.getItem('cymcast.deviceSimulator.v1'),
    ).hardwareId;
    expect(panelOptions.panelId).toBe(storedHardwareId);
    expect(panelOptions.requestedCode).toBeUndefined();
  });
});

describe('DeviceSimulator version selector', () => {
  /** Fills a valid config and selects the given version, returning the utils. */
  const renderWithVersion = (version) => {
    const utils = renderReady();
    fireEvent.change(utils.getByTestId('simulator-config-version'), { target: { value: version } });
    return utils;
  };

  test('the config panel shows the active version description', () => {
    const { getByTestId } = renderWithVersion('v2');

    expect(getByTestId('simulator-version-description')).toHaveTextContent(/grant/i);
  });

  test('v1 (default) advertises show-pin and reports the room code', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    expect(panelOptions.advertiseShowPin).toBe(true);
    act(() => panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' }));
    expect(birdDevice.reportCymcastRoomCode).toHaveBeenCalledWith('CYM99');
  });

  test('v2 omits show-pin and does NOT report the room code', async () => {
    const { getByTestId } = renderWithVersion('v2');
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    expect(panelOptions.advertiseShowPin).toBe(false);
    act(() => panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' }));
    expect(birdDevice.reportCymcastRoomCode).not.toHaveBeenCalled();
  });

  test('v3 registers with a receiver token (getRegisterToken passed to the panel)', async () => {
    const { getByTestId } = renderWithVersion('v3');
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    expect(panelOptions.advertiseShowPin).toBe(false);
    expect(typeof panelOptions.getRegisterToken).toBe('function');

    await panelOptions.getRegisterToken();
    expect(birdDevice.fetchCymcastReceiverToken).toHaveBeenCalled();

    act(() => panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' }));
    expect(birdDevice.reportCymcastRoomCode).not.toHaveBeenCalled();
  });

  test('v1 and v2 do not pass a register token', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    expect(panelOptions.getRegisterToken).toBeNull();
  });

  test('v2 hides the cast PIN and labels the room code as not reported', async () => {
    const { getByTestId, queryByTestId } = renderWithVersion('v2');
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' }));
    expect(queryByTestId('simulator-cast-pin')).toBeNull();
    expect(getByTestId('simulator-cymcast-code')).toHaveTextContent(/not reported/i);
  });

  test('the live view banner names the active version', async () => {
    const { getByTestId } = renderWithVersion('v2');
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    expect(getByTestId('simulator-active-version')).toHaveTextContent('v2');
  });

  test('the selected version persists to localStorage', () => {
    renderWithVersion('v2');

    expect(JSON.parse(window.localStorage.getItem('cymcast.deviceSimulator.v1')).version).toBe('v2');
  });
});

describe('DeviceSimulator fullscreen', () => {
  /** Renders the simulator live so the cast screen (and its toggle) is shown. */
  const renderLive = async () => {
    const utils = renderReady();
    fireEvent.click(utils.getByTestId('simulator-go-live'));
    await waitFor(() => utils.getByTestId('simulator-device-code'));
    return utils;
  };

  afterEach(() => {
    delete window.HTMLElement.prototype.requestFullscreen;
    delete document.exitFullscreen;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  test('the fullscreen toggle starts labeled Fullscreen', async () => {
    const { getByTestId } = await renderLive();

    const toggle = getByTestId('simulator-fullscreen-toggle');

    expect(toggle).toHaveTextContent('Fullscreen');
    expect(toggle).not.toHaveTextContent('Exit fullscreen');
  });

  test('clicking the toggle requests fullscreen on the screen area', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    window.HTMLElement.prototype.requestFullscreen = requestFullscreen;
    const { getByTestId } = await renderLive();

    fireEvent.click(getByTestId('simulator-fullscreen-toggle'));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances[0]).toBe(getByTestId('simulator-screen'));
  });

  test('entering fullscreen switches the label to Exit fullscreen', async () => {
    const { getByTestId } = await renderLive();

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: getByTestId('simulator-screen'),
    });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(getByTestId('simulator-fullscreen-toggle')).toHaveTextContent('Exit fullscreen');
  });

  test('clicking the toggle while fullscreen exits fullscreen', async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = exitFullscreen;
    const { getByTestId } = await renderLive();

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: getByTestId('simulator-screen'),
    });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    fireEvent.click(getByTestId('simulator-fullscreen-toggle'));

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('DeviceSimulator Cymcast room code', () => {
  test('the room code from the panel is reported to the bird device', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' }));

    expect(birdDevice.reportCymcastRoomCode).toHaveBeenCalledWith('CYM99');
  });

  test('the reported Cymcast room code is displayed and differs from the Room ID', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' }));

    expect(getByTestId('simulator-cymcast-code')).toHaveTextContent('CYM99');
    expect(getByTestId('simulator-device-code')).toHaveTextContent('ABC12');
  });

  test('the same room code is reported only once', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => {
      panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' });
      panelCallbacks.onRoom({ code: 'CYM99', displayPin: '004271' });
    });

    expect(birdDevice.reportCymcastRoomCode).toHaveBeenCalledTimes(1);
  });
});

describe('DeviceSimulator PIN surfacing', () => {
  test('the pairing PIN from the bird core is displayed', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => birdCallbacks.onPairingPin('123456'));

    expect(getByTestId('simulator-pairing-pin-value')).toHaveTextContent('123456');
  });

  test('the cast PIN is the room displayPin revealed on show-pin', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => {
      panelCallbacks.onRoom({ code: 'ABC12', displayPin: '004271' });
      panelCallbacks.onCastPin(60000);
    });

    expect(getByTestId('simulator-cast-pin-value')).toHaveTextContent('004271');
  });

  test('a paired event surfaces the paired pill', async () => {
    const { getByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => birdCallbacks.onPaired({ deviceName: 'Sim Room' }));

    expect(getByTestId('simulator-paired')).toHaveTextContent('Sim Room');
  });
});

describe('DeviceSimulator casting', () => {
  test('an incoming stream attaches to the video element and hides the idle overlay', async () => {
    const { getByTestId, queryByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    act(() => {
      panelCallbacks.onVideoTrack({ id: 'stream-1' });
      panelCallbacks.onCasting(true);
    });

    await waitFor(() => expect(queryByTestId('simulator-screen-idle')).not.toBeInTheDocument());
    expect(getByTestId('simulator-video').srcObject).toEqual({ id: 'stream-1' });
  });

  test('stop tears down both cores and returns to the config panel', async () => {
    const { getByTestId, queryByTestId } = renderReady();
    fireEvent.click(getByTestId('simulator-go-live'));
    await waitFor(() => getByTestId('simulator-device-code'));

    fireEvent.click(getByTestId('simulator-stop'));

    expect(birdDevice.stop).toHaveBeenCalled();
    expect(panelReceiver.stop).toHaveBeenCalled();
    await waitFor(() => expect(queryByTestId('simulator-config-panel')).toBeInTheDocument());
  });
});
