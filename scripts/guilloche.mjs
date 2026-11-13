// Writes public/guilloche.svg and public/waves.svg, the two security-print textures.
// Pure geometry, no randomness: run it again and the files come out the same.
import { writeFileSync } from "node:fs";

const f = (n) => n.toFixed(1);

function trochoid(R, r, d, cx, cy, steps) {
  const k = (R - r) / r;
  const turns = r / gcd(R, r);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    pts.push(`${f(cx + (R - r) * Math.cos(t) + d * Math.cos(k * t))},${f(cy + (R - r) * Math.sin(t) - d * Math.sin(k * t))}`);
  }
  return `M${pts.join("L")}Z`;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

const rings = [
  { R: 260, r: 20, d: 46, stroke: "#ffffff", o: 0.22, w: 0.8 },
  { R: 220, r: 30, d: 64, stroke: "#ff3d8b", o: 0.55, w: 0.9 },
  { R: 180, r: 12, d: 40, stroke: "#6ff2c0", o: 0.4, w: 0.7 },
  { R: 120, r: 15, d: 34, stroke: "#ffffff", o: 0.18, w: 0.7 },
];
const paths = rings
  .map((g) => `<path d="${trochoid(g.R, g.r, g.d, 320, 320, 1400)}" fill="none" stroke="${g.stroke}" stroke-opacity="${g.o}" stroke-width="${g.w}"/>`)
  .join("");
writeFileSync("public/guilloche.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">${paths}</svg>\n`);

const lines = [];
for (let row = 0; row < 12; row++) {
  const y0 = row * 10 + 5;
  const pts = [];
  for (let x = 0; x <= 240; x += 4) pts.push(`${x},${f(y0 + Math.sin((x / 240) * Math.PI * 4 + row * 0.5) * 3)}`);
  lines.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#6ff2c0" stroke-opacity="0.16" stroke-width="0.7"/>`);
}
writeFileSync("public/waves.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">${lines.join("")}</svg>\n`);
console.log("wrote public/guilloche.svg and public/waves.svg");
