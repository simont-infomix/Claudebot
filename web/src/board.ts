/**
 * Look-and-feel bits shared by the post-it board: paper colours, textures, tilt, pins.
 *
 * Everything is generated inline (no font or image downloads) so the app keeps working on a
 * machine with no network — it is a loopback-only tool.
 */

import type { Status } from './types';

/** Casual handwriting stack; degrades to the system sans where none of these are installed. */
export const HAND_FONT =
  "'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', 'Segoe UI', sans-serif";

/** Tiling grayscale noise, used as a multiply layer to fake cork and paper fibre. */
function noise(frequency: number, opacity: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='n'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='4' stitchTiles='stitch'/>` +
    `<feColorMatrix type='saturate' values='0'/>` +
    `</filter>` +
    `<rect width='160' height='160' filter='url(#n)' opacity='${opacity}'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const CORK_NOISE = noise(0.85, 0.5);
const PAPER_NOISE = noise(0.7, 0.18);

/** The wall itself: cork in light mode, dark felt in dark mode. Applied to `body`. */
export const CORK_LIGHT = {
  backgroundColor: '#c19a6b',
  backgroundImage: `${CORK_NOISE}, radial-gradient(circle at 22% 18%, rgba(255,255,255,0.22), transparent 55%), radial-gradient(circle at 78% 82%, rgba(60,32,8,0.28), transparent 60%)`,
  backgroundBlendMode: 'multiply, screen, multiply',
  backgroundAttachment: 'fixed',
};

export const CORK_DARK = {
  backgroundColor: '#4a3a28',
  backgroundImage: `${CORK_NOISE}, radial-gradient(circle at 22% 18%, rgba(255,220,170,0.12), transparent 55%), radial-gradient(circle at 78% 82%, rgba(0,0,0,0.45), transparent 60%)`,
  backgroundBlendMode: 'multiply, screen, multiply',
  backgroundAttachment: 'fixed',
};

/** Paper colour per status — the wall stays glanceable: yellow = todo, blue = running, green = done. */
type Paper = { light: string; dark: string };

export const NOTE_PAPER: Record<Status, Paper> = {
  open: { light: '#fdf07a', dark: '#e4d472' },
  in_progress: { light: '#a9dcfb', dark: '#96c4e2' },
  closed: { light: '#cbe8ac', dark: '#b3cf98' },
};

/** Post-its are light paper in both colour schemes, so the text on them is always dark ink. */
export const INK = '#33301f';
export const INK_SOFT = 'rgba(51,48,31,0.62)';

/** Warm off-white for the opened note (a notepad page rather than a sticky). */
export const SHEET = { light: '#fffcf0', dark: '#262117' };

export const PAPER_TEXTURE = PAPER_NOISE;

const TILTS = [-1.7, 1.1, -0.7, 1.9, -1.3, 0.5, 1.5, -2.1, 0.9];
const PINS = ['#d24b42', '#3d7fd6', '#2f9e56', '#e0891c', '#8b52bd', '#c93b7c'];

/** Deterministic per id, so a note keeps its angle and pin across refreshes. */
export function noteTilt(id: number): number {
  return TILTS[Math.abs(id) % TILTS.length] ?? 0;
}

export function pinColor(id: number): string {
  return PINS[Math.abs(id) % PINS.length] ?? '#d24b42';
}
