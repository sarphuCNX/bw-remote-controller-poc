import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import classes from './simulator.module.css';

/**
 * Copies text to the clipboard, tolerating environments without the API.
 * @param {string} value - text to copy
 * @returns {Promise<void>} resolves when the copy attempt completes
 */
async function copyToClipboard(value) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
    }
  } catch (_) {
    // clipboard unavailable — the PIN is still visible for manual copy
  }
}

/**
 * A PIN card with a copy button and an optional TTL countdown. Used for both
 * the pairing PIN (bird 2FA) and the cast PIN (cymcast show-pin).
 * @param {object} props - component props
 * @param {string} props.label - which PIN this is (e.g. "Pairing PIN")
 * @param {string} props.value - the PIN value
 * @param {?number} props.expiresAt - epoch ms when the PIN expires (optional)
 * @param {boolean} [props.cast] - style as the cast PIN
 * @param {string} props.testId - data-testid for the card
 * @returns {?JSX.Element} the PIN card, or null when there is no value
 */
export const PinDisplay = ({ label, value, expiresAt, cast = false, testId }) => {
  const [secondsLeft, setSecondsLeft] = useState(null);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(null);
      return undefined;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!value) return null;

  return (
    <div className={`${classes.pinCard} ${cast ? classes.pinCardCast : ''}`} data-testid={testId}>
      <div className={classes.pinLabel}>{label}</div>
      <div className={classes.pinValue} data-testid={`${testId}-value`}>
        {value}
      </div>
      {secondsLeft !== null ? (
        <div className={classes.pinTtl}>expires in {secondsLeft}s</div>
      ) : null}
      <button
        type="button"
        className={classes.copyButton}
        onClick={() => copyToClipboard(value)}
        data-testid={`${testId}-copy`}
      >
        Copy
      </button>
    </div>
  );
};

PinDisplay.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string,
  expiresAt: PropTypes.number,
  cast: PropTypes.bool,
  testId: PropTypes.string.isRequired,
};
