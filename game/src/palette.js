// Ember Yard — the look plan, in one place. Dusk industrial yard: cold slate and
// concrete, warm ember accent for the player's team and UI, teal for the enemy
// team. Six values and two team hues; the lighting makes every shade the game
// needs, so no other colour appears in the code. The same names are the CSS
// custom properties in index.html.
export const PALETTE = {
  canvas: '#161a20',
  surface: '#20262e',
  hairline: '#313a44',
  ink: '#ece7db',
  muted: '#9aa4ad',
  accent: '#f0a830',
  ember: '#f0a830',
  ash: '#2fa8a0',
  danger: '#e0533d',
};

export function shade(name) {
  return PALETTE[name];
}
