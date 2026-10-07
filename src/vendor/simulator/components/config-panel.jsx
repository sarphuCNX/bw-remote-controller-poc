import React from 'react';
import PropTypes from 'prop-types';
import classes from './simulator.module.css';
import { SIMULATOR_VERSIONS, getVersion, DEFAULT_VERSION_ID } from '../core/simulator-versions';

const FIELDS = [
  { key: 'birdUrl', label: 'Bird server URL (pairing)', type: 'text' },
  { key: 'cymcastUrl', label: 'Cymcast server URL (cast)', type: 'text' },
  { key: 'panelSecret', label: 'Cymcast panel secret', type: 'password' },
  { key: 'deviceName', label: 'Device name (shown in dashboard)', type: 'text' },
];

/**
 * Editable configuration for the device simulator (server URLs + panel secret),
 * shown before the device goes live.
 * @param {object} props - component props
 * @param {object} props.config - current config values
 * @param {function(object): void} props.onChange - receives the full next config
 * @param {function(): void} props.onGoLive - starts the simulated device
 * @param {boolean} props.canGoLive - whether the config is complete
 * @param {boolean} props.connecting - whether a go-live is in flight
 * @returns {JSX.Element} the config panel
 */
export const ConfigPanel = ({ config, onChange, onGoLive, canGoLive, connecting }) => {
  const update = (key) => (event) => onChange({ ...config, [key]: event.target.value });
  const activeVersion = getVersion(config.version || DEFAULT_VERSION_ID);

  return (
    <div className={classes.panel} data-testid="simulator-config-panel">
      <div className={classes.configRow}>
        <label className={classes.configLabel} htmlFor="sim-version">
          Simulator version
        </label>
        <select
          id="sim-version"
          className={classes.configInput}
          value={activeVersion.id}
          onChange={update('version')}
          data-testid="simulator-config-version"
        >
          {SIMULATOR_VERSIONS.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}
            </option>
          ))}
        </select>
        <div className={classes.configHint} data-testid="simulator-version-description">
          {activeVersion.description}
        </div>
      </div>
      {FIELDS.map((field) => (
        <div className={classes.configRow} key={field.key}>
          <label className={classes.configLabel} htmlFor={`sim-${field.key}`}>
            {field.label}
          </label>
          <input
            id={`sim-${field.key}`}
            className={classes.configInput}
            type={field.type}
            value={config[field.key] || ''}
            onChange={update(field.key)}
            data-testid={`simulator-config-${field.key}`}
          />
        </div>
      ))}
      <div className={classes.configRow}>
        <span className={classes.configLabel}>Hardware ID: {config.hardwareId}</span>
      </div>
      <button
        type="button"
        className={classes.primaryButton}
        disabled={!canGoLive || connecting}
        onClick={onGoLive}
        data-testid="simulator-go-live"
      >
        {connecting ? 'Bringing device online…' : 'Go live'}
      </button>
    </div>
  );
};

ConfigPanel.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onGoLive: PropTypes.func.isRequired,
  canGoLive: PropTypes.bool,
  connecting: PropTypes.bool,
};
