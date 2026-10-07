import React from 'react';
import PropTypes from 'prop-types';

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');

/**
 * Live numbers for the active input path plus a JSON export of the snapshot.
 * @param {object} props - component props
 * @param {object|null} props.metrics - the latest snapshot from useControlSession
 * @param {string[]} props.log - recent log lines
 * @returns {JSX.Element} the panel
 */
export const MetricsPanel = ({ metrics, log }) => {
  const download = () => {
    const blob = new Blob([JSON.stringify({ metrics, log }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remote-control-run-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="metrics" data-testid="metrics-panel">
      <div className="metrics-grid">
        <div>
          <div className="metrics-label">path</div>
          <div data-testid="metrics-path">{(metrics && metrics.path) || '-'}</div>
        </div>
        <div>
          <div className="metrics-label">ICE pair</div>
          <div data-testid="metrics-pair">{(metrics && metrics.pairType) || '-'}</div>
        </div>
        <div>
          <div className="metrics-label">probe RTT p50 / p95 ms</div>
          <div data-testid="metrics-rtt">
            {metrics ? `${fmt(metrics.probeRtt.p50)} / ${fmt(metrics.probeRtt.p95)}` : '-'}
          </div>
        </div>
        <div>
          <div className="metrics-label">RTT jitter ms</div>
          <div>{metrics ? fmt(metrics.probeRtt.jitter) : '-'}</div>
        </div>
        <div>
          <div className="metrics-label">ack RTT p50 / p95 ms</div>
          <div>{metrics ? `${fmt(metrics.ackRtt.p50)} / ${fmt(metrics.ackRtt.p95)}` : '-'}</div>
        </div>
        <div>
          <div className="metrics-label">events / s</div>
          <div>{metrics ? fmt(metrics.eventsPerSecond) : '-'}</div>
        </div>
        <div>
          <div className="metrics-label">ICE RTT ms</div>
          <div>{metrics && metrics.iceRttMs != null ? fmt(metrics.iceRttMs) : '-'}</div>
        </div>
        <div>
          <div className="metrics-label">relay forced</div>
          <div>{metrics ? String(metrics.forceRelay) : '-'}</div>
        </div>
      </div>
      <button type="button" onClick={download} disabled={!metrics} data-testid="metrics-export">
        Export JSON
      </button>
      <pre className="log" data-testid="metrics-log">
        {log.slice(-12).join('\n')}
      </pre>
    </div>
  );
};

MetricsPanel.propTypes = {
  metrics: PropTypes.object,
  log: PropTypes.arrayOf(PropTypes.string).isRequired,
};
