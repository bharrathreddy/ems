// Keeps any institution colour readable: darkens it until white text passes WCAG AA (4.5:1).
function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: number[]) {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrastWithWhite = (rgb: number[]) => 1.05 / (luminance(rgb) + 0.05);
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function applyBrand(color?: string | null) {
  const root = document.documentElement;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
    root.style.removeProperty('--brand');
    root.style.removeProperty('--brand-soft');
    return;
  }
  let rgb = hexToRgb(color);
  for (let i = 0; i < 20 && contrastWithWhite(rgb) < 4.5; i++) rgb = rgb.map((v) => v * 0.9);
  root.style.setProperty('--brand', toHex(rgb));
  root.style.setProperty('--brand-soft', toHex(rgb.map((v) => v + (255 - v) * 0.88)));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', toHex(rgb));
}
