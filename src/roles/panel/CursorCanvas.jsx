import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const TRAIL = 40;

/**
 * Draws the virtual screen with the cursor and a short trail, so pointer
 * smoothness is visible at a glance (a jittery path shows as a ragged trail).
 * @param {object} props - component props
 * @param {{x: number, y: number, buttons: number}} props.cursor - current cursor
 * @param {{width: number, height: number}} props.surface - virtual screen size
 * @returns {JSX.Element} the canvas
 */
export const CursorCanvas = ({ cursor, surface }) => {
  const canvasRef = useRef(null);
  const trailRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = canvas.width / surface.width;
    trailRef.current.push({ x: cursor.x, y: cursor.y });
    if (trailRef.current.length > TRAIL) trailRef.current.shift();

    ctx.fillStyle = '#0b0820';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    trailRef.current.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * scale, p.y * scale);
      else ctx.lineTo(p.x * scale, p.y * scale);
    });
    ctx.stroke();
    ctx.fillStyle = cursor.buttons ? '#ff7a59' : '#ffffff';
    ctx.beginPath();
    ctx.arc(cursor.x * scale, cursor.y * scale, 6, 0, Math.PI * 2);
    ctx.fill();
  }, [cursor, surface]);

  return <canvas ref={canvasRef} width={640} height={360} className="screen" data-testid="cursor-canvas" />;
};

CursorCanvas.propTypes = {
  cursor: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number, buttons: PropTypes.number }).isRequired,
  surface: PropTypes.shape({ width: PropTypes.number, height: PropTypes.number }).isRequired,
};
