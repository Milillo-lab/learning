/* Local incidence angle and terrain effects: RiSE Lab learning module (CIVE 6359).
   Geometry conventions
   - Flat Earth, parallel rays (the satellite is about 750 km away).
   - b: compass bearing from the ground to the satellite = heading + 90 (left-looking) or heading - 90 (right-looking).
   - l = unit vector ground -> satellite; p = unit vector in the plane of incidence, perpendicular to l, pointing up:
     the normal of the radar image plane. For a unit surface normal n:
       cos(theta_loc) = n.l        (local incidence angle)
       n.p                         (image area per unit of slope area; sin(theta_loc) for a slope tilted in range)
       layover  where n.p <= 0     (a slope facing the radar steeper than theta)
       shadow   where n.l <= 0, or where terrain nearer the satellite blocks the ray
   - Brightness model (teaching): sigma0 = cos^2(theta_loc) (Lambert), pixel value = sigma0 x surface area per image
     cell, so relative to level ground: [cos^2 theta_loc / cos^2 theta] x [sin theta / (n.p)]. */
'use strict';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const HEAD = { asc: 344.5, desc: 195.5 };       // NISAR ascending over the Panamint Range, from its GCOV LOS vector; descending mirrored
const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const mod360 = a => ((a % 360) + 360) % 360;
const wrap180 = a => { a = mod360(a); return a > 180 ? a - 360 : a; };
const COMP = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = b => COMP[Math.round(mod360(b) / 22.5) % 16];
const fmt = (x, n = 1) => (Math.abs(x) < 0.5 * Math.pow(10, -n) ? 0 : x).toFixed(n);
const sgn = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1);

// ------------------------------------------------------------------ theme
(function () { try { const t = localStorage.getItem('sargeom-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) { } })();
$('theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const nt = dark ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', nt);
  try { localStorage.setItem('sargeom-theme', nt); } catch (e) { }
  drawXS(); drawMap(); drawPanamint(); drawChart(); drawSim(false);
});

// ------------------------------------------------------------------ shared state
const st = { inc: 40, slope: 20, aspect: 74.5, look: 'left', pass: 'asc' };
const satBearing = s => mod360(HEAD[s.pass] + (s.look === 'left' ? 90 : -90));

function slopeGeom(s) {
  const th = s.inc * D2R, al = s.slope * D2R, b = satBearing(s);
  const phi = wrap180(s.aspect - b) * D2R;                 // 0: faces the satellite, 180: faces away
  const cosL = Math.sin(al) * Math.cos(phi) * Math.sin(th) + Math.cos(al) * Math.cos(th);
  const np = -Math.sin(al) * Math.cos(phi) * Math.cos(th) + Math.cos(al) * Math.sin(th);
  const loc = Math.acos(Math.max(-1, Math.min(1, cosL))) * R2D;
  const ar = Math.atan(Math.tan(al) * Math.cos(phi)) * R2D;  // tilt in the range plane, + toward the radar
  const lay = np <= 1e-9, sha = cosL <= 1e-9 || ar < -(90 - s.inc);
  const S = cosL > 0 ? (cosL * cosL) / Math.cos(th) ** 2 : 0;
  const K = np > 0 ? Math.sin(th) / np : Infinity;
  return { th, al, b, phi: phi * R2D, cosL, np, loc, ar, lay, sha, S, K };
}

// ------------------------------------------------------------------ part 1: controls
function seg(id, key, cb) {
  const el = $(id);
  el.querySelectorAll('button').forEach(bt => bt.addEventListener('click', () => { st[key] = bt.dataset.v; cb(); }));
}
function syncSeg(id, v) { $(id).querySelectorAll('button').forEach(bt => bt.classList.toggle('on', bt.dataset.v === v)); }
function setDir(dir) {
  const b = satBearing(st);
  st.aspect = mod360(dir === 'toward' ? b : dir === 'away' ? b + 180 : HEAD[st.pass]);
  updateAll();
}
document.querySelectorAll('[data-dir]').forEach(bt => bt.addEventListener('click', () => setDir(bt.dataset.dir)));
$('inc').addEventListener('input', e => { st.inc = +e.target.value; updateAll(); });
$('slp').addEventListener('input', e => { st.slope = +e.target.value; updateAll(); });
$('asp').addEventListener('input', e => { st.aspect = +e.target.value; updateAll(); });
seg('look', 'look', updateAll); seg('pass', 'pass', updateAll);
seg('slook', 'look', updateAll); seg('spass', 'pass', updateAll);
$('sinc').addEventListener('input', e => { st.inc = +e.target.value; updateAll(); });
$('pre-video').addEventListener('click', () => { st.inc = 40; st.slope = 20; st.look = 'left'; st.pass = 'asc'; st.aspect = satBearing(st); updateAll(); });
$('pre-reset').addEventListener('click', () => { st.slope = 0; updateAll(); });
$('pre-nisar').addEventListener('click', () => { st.inc = 39.3; st.look = 'left'; st.pass = 'asc'; $('site').value = 'panamint'; updateAll(); });

let simTimer = null;
function updateAll() {
  $('inc').value = st.inc; $('slp').value = st.slope; $('asp').value = Math.round(st.aspect); $('sinc').value = st.inc;
  syncSeg('look', st.look); syncSeg('pass', st.pass); syncSeg('slook', st.look); syncSeg('spass', st.pass);
  $('incv').textContent = fmt(st.inc) + '°'; $('sincv').textContent = fmt(st.inc) + '°';
  $('slpv').textContent = fmt(st.slope) + '°';
  $('aspv').textContent = compass(st.aspect) + ' (' + Math.round(st.aspect) + '°)';
  drawXS(); drawMap(); readouts();
  clearTimeout(simTimer); simTimer = setTimeout(() => drawSim(true), 30);
}

function readouts() {
  const g = slopeGeom(st);
  const ban = $('banner');
  const lim = `layover if it tilts toward the radar by more than ${fmt(st.inc)}°; shadow if it tilts away by more than ${fmt(90 - st.inc)}°`;
  if (g.lay) { ban.className = 'banner lay'; ban.textContent = `LAYOVER: the top comes back before the foot (${lim}).`; }
  else if (g.sha) { ban.className = 'banner sha'; ban.textContent = `SHADOW: the wave cannot reach this slope (${lim}).`; }
  else { ban.className = 'banner'; ban.textContent = `No layover, no shadow: ${lim}.`; }
  $('r-loc').textContent = fmt(g.loc) + '°';
  $('r-locs').textContent = `incidence ${fmt(st.inc)}°, ${dirWord(g.phi, st.slope)}`;
  if (g.sha) { $('r-db').textContent = 'no echo'; $('r-dbs').textContent = 'noise only'; }
  else if (g.lay) { $('r-db').textContent = 'n/a'; $('r-dbs').textContent = 'added on top of the ground in front'; }
  else {
    const s = 10 * Math.log10(g.S), k = 10 * Math.log10(g.K);
    $('r-db').textContent = sgn(s + k) + ' dB';
    $('r-dbs').textContent = `scattering ${sgn(s)}, squeeze ${sgn(k)} dB`;
  }
  $('r-sq').textContent = g.np > 0 ? g.np.toFixed(2) : g.np.toFixed(2) + ' (folded)';
  const lvl = Math.sin(g.th);
  $('r-sqs').textContent = Math.abs(wrap180(g.phi)) < 1 || Math.abs(wrap180(g.phi)) > 179 || st.slope === 0
    ? `km of slant range per km of slope; level ${lvl.toFixed(2)}` : `level ground ${lvl.toFixed(2)}; the slope tilts partly along the track`;
  $('r-ar').textContent = fmt(Math.abs(g.ar)) + '°';
  $('r-ars').textContent = st.slope === 0 ? 'level' : Math.abs(g.ar) < 0.05 ? 'none: tilts along the track' : g.ar > 0 ? 'toward the radar' : 'away from the radar';
}
function dirWord(phi, slope) {
  if (slope === 0) return 'level ground';
  const a = Math.abs(wrap180(phi));
  if (a <= 22.5) return 'slope faces the radar';
  if (a >= 157.5) return 'slope faces away';
  if (a >= 67.5 && a <= 112.5) return 'slope tilts along the track';
  return a < 90 ? 'slope faces partly toward the radar' : 'slope faces partly away';
}

// ------------------------------------------------------------------ part 1: cross-section SVG
const NS = 'http://www.w3.org/2000/svg';
function el(tag, at, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in at) e.setAttribute(k, at[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function drawXS() {
  const svg = $('xs'); while (svg.firstChild) svg.removeChild(svg.firstChild);
  const g = slopeGeom(st), th = g.th, sinT = Math.sin(th), cosT = Math.cos(th), cotT = cosT / sinT;
  const satRight = st.look === 'left';             // seen from behind the satellite: left-looking puts it on the right
  const sig = satRight ? 1 : -1;
  const k = 135, XC = 360, YC = 200;                // px per km; screen centre maps to (u=0.5 km, z=0)
  const X = u => XC - sig * (u - 0.5) * k, Y = z => YC - z * k;
  const W = 720, top = 34, bot = 352;
  const ink = css('--ink'), muted = css('--muted'), faint = css('--faint'), rule = css('--rule');
  const ar = g.ar * D2R, Lh = Math.cos(ar), Hh = Math.sin(ar);   // the slope, 1 km long in this plane
  const terr = u => (u <= 0 ? 0 : u >= Lh ? Hh : u * Math.tan(ar));
  const uMin = 0.5 - (W / 2 + 10) / k, uMax = 0.5 + (W / 2 + 10) / k;
  const defs = el('defs', {}, svg);
  const clip = el('clipPath', { id: 'xsclip' }, defs); el('rect', { x: 0, y: top, width: W, height: bot - top }, clip);
  const scene = el('g', { 'clip-path': 'url(#xsclip)' }, svg);

  // equally spaced lines of constant slant range r = u sin(th) - z cos(th), every 0.1 km
  const rr = [];
  for (const [u, z] of [[uMin, 1.4], [uMax, 1.4], [uMin, -1.4], [uMax, -1.4]]) rr.push(u * sinT - z * cosT);
  const r0 = Math.min(...rr), r1 = Math.max(...rr);
  for (let r = Math.ceil(r0 * 10) / 10; r <= r1; r += 0.1) {
    // points on the line: (u, z) = r*(sin, -cos) + t*(cos, sin)
    const p1 = [r * sinT - 3 * cosT, -r * cosT - 3 * sinT], p2 = [r * sinT + 3 * cosT, -r * cosT + 3 * sinT];
    el('line', { x1: X(p1[0]), y1: Y(p1[1]), x2: X(p2[0]), y2: Y(p2[1]), stroke: faint, 'stroke-width': 1, opacity: 0.45 }, scene);
  }

  // visibility along the profile (shadow): blocked if max over nearer points of z + u cot(th) exceeds the point's own
  const N = 1400, us = [], zs = [], vis = [], uA = uMin - 2, uB = uMax + 2;
  let qmax = -1e9;
  for (let i = 0; i <= N; i++) { const u = uA + (uB - uA) * i / N; us.push(u); zs.push(terr(u)); }
  for (let i = 0; i <= N; i++) { const q = zs[i] + us[i] * cotT; vis.push(q >= qmax - 1e-9); qmax = Math.max(qmax, q); }
  if (g.sha && Math.abs(g.ar) < 1e-6) { for (let i = 0; i <= N; i++) if (us[i] > 0 && us[i] < Lh) vis[i] = false; } // along-track self-shadow

  // ground
  const pts = us.map((u, i) => `${X(u)},${Y(zs[i])}`).join(' ');
  el('polygon', { points: `${X(uA)},${bot} ${pts} ${X(uB)},${bot}`, fill: css('--terrain-2'), opacity: 0.55 }, scene);
  // rays from the satellite, parallel, stopping where they first meet the ground
  for (let c = -2.2; c <= 3.2; c += 0.32) {
    let hit = null;
    for (let r = -3; r < 3; r += 0.004) {
      const u = c * cosT + r * sinT, z = c * sinT - r * cosT;
      if (u > uMin - 1 && u < uMax + 1 && z <= terr(u)) { hit = [u, z, r]; break; }
    }
    if (!hit) continue;
    const r0r = -3; const ua = c * cosT + r0r * sinT, za = c * sinT - r0r * cosT;
    el('line', { x1: X(ua), y1: Y(za), x2: X(hit[0]), y2: Y(hit[1]), stroke: css('--los'), 'stroke-width': 1, opacity: 0.45, 'stroke-dasharray': '4 4' }, scene);
  }
  // shadowed parts of the ground
  for (let i = 0; i < N; i++) if (!vis[i] || !vis[i + 1]) {
    el('line', { x1: X(us[i]), y1: Y(zs[i]), x2: X(us[i + 1]), y2: Y(zs[i + 1]), stroke: css('--shadow'), 'stroke-width': 7, 'stroke-linecap': 'round' }, scene);
  }
  // level ground in front of a layover slope that shares its range
  const rTop = Lh * sinT - Hh * cosT;
  if (g.lay) el('line', { x1: X(rTop / sinT), y1: Y(0) + 6, x2: X(0), y2: Y(0) + 6, stroke: css('--layover'), 'stroke-width': 3, 'stroke-dasharray': '5 3' }, scene);
  // the profile, the slope highlighted
  el('polyline', { points: pts, fill: 'none', stroke: css('--terrain'), 'stroke-width': 2.5 }, scene);
  const slopeCol = g.lay ? css('--layover') : g.sha ? css('--shadow') : css('--track');
  el('line', { x1: X(0), y1: Y(0), x2: X(Lh), y2: Y(Hh), stroke: slopeCol, 'stroke-width': 5, 'stroke-linecap': 'round' }, scene);
  if (st.slope > 0 && Math.abs(g.ar) < 0.05) {
    el('text', { x: X(Lh / 2), y: Y(0) + 22, 'text-anchor': 'middle', 'font-size': 12, fill: muted }, scene, 'this slope tilts along the track: in this view it looks level');
  }

  // angles at the middle of the slope
  const M = [Lh / 2, Hh / 2];
  const sv = (du, dz) => [-sig * du, -dz];          // world direction -> screen direction
  const ray = (d, len, col, w, dash) => el('line', { x1: X(M[0]), y1: Y(M[1]), x2: X(M[0]) + sv(d[0], d[1])[0] * len * k, y2: Y(M[1]) + sv(d[0], d[1])[1] * len * k, stroke: col, 'stroke-width': w, 'stroke-dasharray': dash || '' }, svg);
  const toSat = [-sinT, cosT], vert = [0, 1], nrm = [-Math.sin(ar), Math.cos(ar)];
  ray(vert, 0.62, faint, 1.5, '5 4');
  ray(toSat, 0.95, css('--los'), 2.2);
  ray(nrm, 0.62, css('--loc'), 2.2);
  const arc = (a, b, rad, col, label, lx) => {
    const A = Math.atan2(sv(a[0], a[1])[1], sv(a[0], a[1])[0]), B = Math.atan2(sv(b[0], b[1])[1], sv(b[0], b[1])[0]);
    let d = B - A; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) < 0.002) return;
    let path = '';
    for (let i = 0; i <= 30; i++) { const t = A + d * i / 30; path += (i ? 'L' : 'M') + (X(M[0]) + rad * Math.cos(t)) + ',' + (Y(M[1]) + rad * Math.sin(t)); }
    el('path', { d: path, fill: 'none', stroke: col, 'stroke-width': 2 }, svg);
    const t = A + d / 2, lr = rad + lx;
    el('text', { x: X(M[0]) + lr * Math.cos(t), y: Y(M[1]) + lr * Math.sin(t) + 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: col }, svg, label);
  };
  arc(vert, toSat, 104, css('--inc'), 'θ ' + fmt(st.inc) + '°', 24);
  const oblique = st.slope > 0 && Math.abs(Math.abs(wrap180(g.phi)) - 0) > 1 && Math.abs(Math.abs(wrap180(g.phi)) - 180) > 1;
  if (!g.sha || g.cosL > 0) arc(nrm, toSat, 50, css('--loc'), 'θloc ' + fmt(g.loc) + '°' + (oblique ? '*' : ''), 40);

  // the satellite, off to its side
  const sx = satRight ? W - 58 : 58, sy = 58;
  const sat = el('g', { transform: `translate(${sx},${sy})` }, svg);
  el('rect', { x: -9, y: -7, width: 18, height: 14, rx: 2, fill: ink }, sat);
  el('rect', { x: -30, y: -4, width: 18, height: 8, fill: css('--track') }, sat);
  el('rect', { x: 12, y: -4, width: 18, height: 8, fill: css('--track') }, sat);
  el('text', { x: satRight ? -36 : 36, y: 4, 'text-anchor': satRight ? 'end' : 'start', 'font-size': 11.5, fill: muted }, sat, 'to the satellite, ~750 km');
  el('text', { x: satRight ? -36 : 36, y: 19, 'text-anchor': satRight ? 'end' : 'start', 'font-size': 11.5, fill: muted }, sat, 'flying into the page');

  // labels: caption and compass ends
  const b = satBearing(st);
  el('text', { x: 12, y: 20, 'font-size': 11, 'letter-spacing': '.06em', fill: muted, 'font-weight': 600 }, svg,
    'VIEW ALONG THE TRACK, FROM BEHIND THE SATELLITE · ' + (st.look === 'left' ? 'NISAR LOOKS LEFT' : 'SENTINEL-1 LOOKS RIGHT'));
  const nearDir = compass(b), farDir = compass(b + 180);
  el('text', { x: satRight ? W - 10 : 10, y: bot - 8, 'text-anchor': satRight ? 'end' : 'start', 'font-size': 11, fill: muted }, svg, 'near range → ' + nearDir);
  el('text', { x: satRight ? 10 : W - 10, y: bot - 8, 'text-anchor': satRight ? 'start' : 'end', 'font-size': 11, fill: muted }, svg, farDir + ' ← far range');
  if (g.lay) el('text', { x: W / 2, y: top + 20, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700, fill: css('--layover') }, svg, 'LAYOVER');
  else if (g.sha) el('text', { x: W / 2, y: top + 20, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700, fill: css('--shadow') }, svg, 'SHADOW');

  // ------------- the radar image strip: echoes binned by slant range
  const yS = 392, hS = 30, zS = 0;  // strip drawn under the scene; x of range r: the level-ground position of that range
  const xr = r => X(r / sinT);
  // contributions: each visible segment deposits sigma0 x length (x area factor on the slope) over its range interval
  const bin = 0.005, rA = uMin * sinT - 1.2 * cosT, rB = uMax * sinT + 1.2 * cosT, nb = Math.ceil((rB - rA) / bin);
  const acc = new Float64Array(nb);
  const areaF = Math.cos(ar) / Math.cos(g.al);       // along-track part of the slope's surface area
  for (let i = 0; i < N; i++) {
    if (!vis[i] || !vis[i + 1]) continue;
    const u0 = us[i], u1 = us[i + 1], z0 = zs[i], z1 = zs[i + 1];
    const mid = (u0 + u1) / 2, onSlope = mid > 0 && mid < Lh;
    const cl = onSlope ? g.cosL : cosT;
    if (cl <= 0) continue;
    const len = Math.hypot(u1 - u0, z1 - z0) * (onSlope ? areaF : 1);
    const ra = u0 * sinT - z0 * cosT, rb = u1 * sinT - z1 * cosT;
    const lo = Math.min(ra, rb), hi = Math.max(ra, rb), w = cl * cl * len;
    const span = Math.max(hi - lo, 1e-9);
    for (let j = Math.floor((lo - rA) / bin); j <= Math.floor((hi - rA) / bin); j++) {
      if (j < 0 || j >= nb) continue;
      const a = Math.max(lo, rA + j * bin), c = Math.min(hi, rA + (j + 1) * bin);
      if (c > a) acc[j] += w * (c - a) / span;
    }
  }
  const lvl = cosT * cosT / sinT * bin;               // a level-ground bin
  el('text', { x: 12, y: yS - 8, 'font-size': 11, 'letter-spacing': '.06em', fill: muted, 'font-weight': 600 }, svg, 'THE RADAR IMAGE OF THIS LINE (ECHOES SORTED BY DISTANCE)');
  el('rect', { x: 0, y: yS, width: W, height: hS, fill: '#000' }, svg);
  const strip = el('g', { 'shape-rendering': 'crispEdges' }, svg);
  const grey = j => { const v = acc[j] / lvl, dB = v > 0 ? 10 * Math.log10(v) : -99; return Math.round(51 * Math.max(0, Math.min(1, (dB + 15) / 25))) * 5; };
  for (let j = 0; j < nb;) {
    const gr = grey(j); let e = j + 1; while (e < nb && grey(e) === gr) e++;
    const xa = xr(rA + j * bin), xb = xr(rA + e * bin);
    if (gr > 0) el('rect', { x: Math.min(xa, xb), y: yS, width: Math.abs(xb - xa) + 0.5, height: hS, fill: `rgb(${gr},${gr},${gr})` }, strip);
    j = e;
  }
  // foot and top markers, with their range lines
  const rFoot = 0;
  const close = Math.abs(xr(rTop) - xr(rFoot)) < 34;
  const mark = (u, z, r, lab, col, other) => {
    el('line', { x1: X(u), y1: Y(z), x2: xr(r), y2: yS, stroke: col, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.8 }, svg);
    el('line', { x1: xr(r), y1: yS - 3, x2: xr(r), y2: yS + hS + 3, stroke: col, 'stroke-width': 2 }, svg);
    const anchor = !close ? 'middle' : xr(r) < xr(other) ? 'end' : 'start', dx = !close ? 0 : anchor === 'end' ? -3 : 3;
    el('text', { x: xr(r) + dx, y: yS + hS + 15, 'text-anchor': anchor, 'font-size': 11.5, 'font-weight': 700, fill: col }, svg, lab);
  };
  if (st.slope > 0 && Math.abs(g.ar) > 0.05) {
    mark(0, 0, rFoot, Hh > 0 ? 'foot' : 'top', ink, rTop);
    mark(Lh, Hh, rTop, Hh > 0 ? 'top' : 'foot', g.lay ? css('--layover') : ink, rFoot);
  }
  const ext = Math.abs(rTop);
  el('text', { x: W / 2, y: yS + hS + 32, 'text-anchor': 'middle', 'font-size': 12, fill: ink }, svg,
    g.sha ? `the slope sends no echo; the shadow covers ${fmt(shadowRange(us, zs, vis, sinT, cosT), 2)} km of slant range (black)` :
      g.lay ? `the top lands ${fmt(ext, 2)} km of slant range BEFORE the foot, on top of the ground in front` :
        `this 1 km of slope: ${ext.toFixed(2)} km of slant range · 1 km of level ground: ${sinT.toFixed(2)} · it crosses ${(ext / 0.1).toFixed(1)} range lines`);

  $('xscap').innerHTML = `Range lines (thin) are equally spaced, 0.1 km apart in distance from the satellite. Dashed orange: rays from the satellite. <b style="color:${css('--inc')}">&theta;</b> is measured from straight up, <b style="color:${css('--loc')}">&theta;<sub>loc</sub></b> from the line perpendicular to the slope.` +
    (oblique ? ' *The slope also tilts along the track, out of this plane: the drawing shows its tilt in the range plane, and &theta;<sub>loc</sub> is the full three-dimensional angle.' : '') +
    ' Strip: grey level is brightness in dB relative to level ground (&minus;15 to +10 dB), black is no echo.';
}
function shadowRange(us, zs, vis, sinT, cosT) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < us.length; i++) if (!vis[i]) { const r = us[i] * sinT - zs[i] * cosT; lo = Math.min(lo, r); hi = Math.max(hi, r); }
  return isFinite(lo) ? hi - lo : 0;
}

// ------------------------------------------------------------------ part 1: map view
function drawMap() {
  const svg = $('map'); while (svg.firstChild) svg.removeChild(svg.firstChild);
  const g = slopeGeom(st), C = 120, R = 92, ink = css('--ink'), muted = css('--muted'), rule = css('--rule');
  const P = (bear, r) => [C + r * Math.sin(bear * D2R), C - r * Math.cos(bear * D2R)];
  el('circle', { cx: C, cy: C, r: R, fill: 'none', stroke: rule, 'stroke-width': 1 }, svg);
  for (const [lab, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) { const p = P(a, R + 11); el('text', { x: p[0], y: p[1] + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: muted }, svg, lab); }
  // ground track through the satellite position
  const b = g.b, sp = P(b, 66), H = HEAD[st.pass];
  const t1 = [sp[0] - 60 * Math.sin(H * D2R), sp[1] + 60 * Math.cos(H * D2R)], t2 = [sp[0] + 60 * Math.sin(H * D2R), sp[1] - 60 * Math.cos(H * D2R)];
  el('line', { x1: t1[0], y1: t1[1], x2: t2[0], y2: t2[1], stroke: css('--track'), 'stroke-width': 2, 'stroke-dasharray': '6 4' }, svg);
  const ah = (x, y, ang, col, s = 8) => {
    const a = ang * D2R, l = [x - s * Math.sin(a) + s * 0.55 * Math.cos(a), y + s * Math.cos(a) + s * 0.55 * Math.sin(a)], r = [x - s * Math.sin(a) - s * 0.55 * Math.cos(a), y + s * Math.cos(a) - s * 0.55 * Math.sin(a)];
    el('polygon', { points: `${x},${y} ${l[0]},${l[1]} ${r[0]},${r[1]}`, fill: col }, svg);
  };
  ah(t2[0], t2[1], H, css('--track'));
  el('rect', { x: sp[0] - 5, y: sp[1] - 4, width: 10, height: 8, fill: ink, transform: `rotate(${H} ${sp[0]} ${sp[1]})` }, svg);
  // look direction: from the satellite to the target in the centre
  el('line', { x1: sp[0], y1: sp[1], x2: C + 12 * Math.sin(b * D2R), y2: C - 12 * Math.cos(b * D2R), stroke: css('--los'), 'stroke-width': 2.2 }, svg);
  ah(C + 12 * Math.sin(b * D2R), C - 12 * Math.cos(b * D2R), b + 180, css('--los'));
  // the slope: a triangle pointing the way it faces (downhill)
  if (st.slope > 0) {
    const a = st.aspect, col = g.lay ? css('--layover') : g.sha ? css('--shadow') : css('--loc');
    const tip = P(a, 20), l = P(a + 140, 12), r = P(a - 140, 12);
    el('polygon', { points: `${tip[0]},${tip[1]} ${l[0]},${l[1]} ${r[0]},${r[1]}`, fill: col, stroke: ink, 'stroke-width': 0.8 }, svg);
  } else el('circle', { cx: C, cy: C, r: 6, fill: css('--loc') }, svg);
  el('text', { x: 6, y: 234, 'font-size': 10.5, fill: muted }, svg, (st.pass === 'asc' ? 'ascending' : 'descending') + ', looks ' + st.look);

  const faces = st.slope > 0 ? `The slope faces ${compass(st.aspect)} (${Math.round(st.aspect)}°)` : 'The ground is level';
  $('mapsent').innerHTML = `${faces}. The satellite flies ${st.pass === 'asc' ? 'north' : 'south'} (heading ${HEAD[st.pass]}°) and looks ${st.look}, so it sits to the <b>${compass(b)}</b> of the ground (bearing ${fmt(b)}°). ` +
    (st.slope > 0 ? `Seen from there, the ${dirWord(g.phi, st.slope)}: local incidence ${fmt(g.loc)}°. ` : '') +
    `In the cross-section, near range is toward the ${compass(b)}.`;
}

// ------------------------------------------------------------------ image helpers
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
function pixels(im) {
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height).data;
}
function lerpCol(stops, t) {
  t = Math.max(0, Math.min(1, t)); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  const a = stops[i], b = stops[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
// local incidence: warm below theta (facing), cool above (away); centred on the incidence angle
const LOC_STOPS = [[120, 30, 10], [214, 96, 30], [246, 190, 120], [240, 240, 236], [150, 190, 222], [60, 110, 180], [25, 45, 105]];
function locColor(loc, inc) {
  const t = loc <= inc ? 0.5 * loc / inc : 0.5 + 0.5 * (loc - inc) / (90 - inc);
  return lerpCol(LOC_STOPS, t);
}
const HGT_STOPS = [[40, 70, 60], [110, 130, 85], [190, 170, 120], [150, 115, 90], [235, 230, 225]];
function locLegend(inc) {
  const n = 10, cols = []; for (let i = 0; i <= n; i++) { const c = lerpCol(LOC_STOPS, i / n); cols.push(`rgb(${c.map(Math.round)})`); }
  return `<span>0°</span><span class="bar" style="background:linear-gradient(90deg,${cols.join(',')})"></span><span>90°</span><span>&middot; white at &theta; = ${fmt(inc)}°; warm faces the radar, cool faces away</span>`;
}

// ------------------------------------------------------------------ part 2: Panamint
const PAN = { ready: false };
const LAYERS = {
  gslc: 'NISAR GSLC (before terrain correction)', gcov: 'NISAR GCOV γ⁰ (after terrain correction)',
  loc: 'local incidence angle (NISAR geometry, Copernicus DEM)', hgt: 'height (Copernicus DEM)', sim: 'simulated (teaching model, NISAR geometry)'
};
for (const id of ['pl', 'pr']) for (const k in LAYERS) { const o = document.createElement('option'); o.value = k; o.textContent = LAYERS[k]; $(id).appendChild(o); }
$('pl').value = 'gslc'; $('pr').value = 'gcov';
let divider = 0.5;
async function initPanamint() {
  const [meta, gs, gc, vals, aux, s1, sites] = await Promise.all([
    fetch('data/panamint_meta.json').then(r => r.json()), loadImg('data/panamint_gslc.webp'), loadImg('data/panamint_gcov.webp'),
    loadImg('data/panamint_vals.png'), loadImg('data/panamint_aux.png'), loadImg('data/panamint_s1.webp'), fetch('data/sites.json').then(r => r.json())]);
  Object.assign(PAN, { meta, gs, gc, n: vals.naturalWidth });
  const v = pixels(vals), a = pixels(aux), n = PAN.n;
  PAN.g = new Float32Array(n * n); PAN.c = new Float32Array(n * n); PAN.li = new Float32Array(n * n); PAN.sl = new Float32Array(n * n); PAN.h = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    PAN.g[i] = v[4 * i] ? (v[4 * i] - 1) / 4 - 30 : NaN; PAN.c[i] = v[4 * i + 1] ? (v[4 * i + 1] - 1) / 4 - 30 : NaN;
    PAN.li[i] = v[4 * i + 2]; PAN.sl[i] = a[4 * i]; PAN.h[i] = 131.5 + ((a[4 * i + 1] << 8) + a[4 * i + 2]) / 65535 * (3356.9 - 131.5);
  }
  // layer canvases
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  PAN.L = {};
  PAN.L.gslc = gs; PAN.L.gcov = gc;
  const cl = mk(n, n), gl = cl.getContext('2d'), il = gl.createImageData(n, n);
  const ch = mk(n, n), gh = ch.getContext('2d'), ih = gh.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const c1 = locColor(PAN.li[i], meta.incidence); il.data.set([...c1.map(Math.round), 255], 4 * i);
    const c2 = lerpCol(HGT_STOPS, (PAN.h[i] - 131.5) / 3225); ih.data.set([...c2.map(Math.round), 255], 4 * i);
  }
  gl.putImageData(il, 0, 0); gh.putImageData(ih, 0, 0); PAN.L.loc = cl; PAN.L.hgt = ch;
  // simulated layer: the part-3 model on the Copernicus tile of the same 40 m grid, with NISAR's geometry for the day
  const tile = await loadTile(sites.panamint_cop30);
  const head = mod360(meta.heading_deg);
  const sim = simulate(tile, { inc: meta.incidence, b: mod360(head + 90), head }, { speckle: true, seed: 7 });
  const cs = mk(tile.w, tile.rows), gsx = cs.getContext('2d'), isx = gsx.createImageData(tile.w, tile.rows);
  const md = PAN.meta.median_dB_by_local_incidence_10m, off = 0.5 * (md['30-40'][0] + md['40-50'][0]);  // level ground at the GSLC's level-ground median
  for (let i = 0; i < tile.w * tile.rows; i++) {
    const dB = sim.mapDB[i] + off, gr = Math.round(255 * Math.max(0, Math.min(1, (dB + 17) / 26)));
    isx.data.set([gr, gr, gr, 255], 4 * i);
  }
  gsx.putImageData(isx, 0, 0); PAN.L.sim = cs;
  // Sentinel-1
  const s1c = $('s1'); s1c.width = s1.naturalWidth; s1c.height = s1.naturalHeight; const g1 = s1c.getContext('2d'); g1.drawImage(s1, 0, 0);
  g1.fillStyle = 'rgba(0,0,0,.55)'; g1.fillRect(0, s1c.height - 54, s1c.width, 54);
  g1.fillStyle = '#fff'; g1.font = '600 22px Archivo, Arial'; g1.fillText('Sentinel-1C VV · 25 Nov 2026 · ascending · looks right (satellite to the WSW)', 16, s1c.height - 20);
  // image up is the flight direction (heading about 344.5 deg), so north sits about 15.5 deg clockwise of up;
  // right-looking: range grows to the right, the satellite is to the left of the image
  drawNorth(g1, s1c.width - 40, 46, 1.4, 360 - HEAD.asc); drawToSat(g1, 150, 120, 270, 'satellite (WSW)');
  PAN.ready = true; drawPanamint(); measure(); drawChart();
}
function drawNorth(g, x, y, s = 1, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot * D2R); g.scale(s, s); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -18); g.lineTo(8, 8); g.lineTo(0, 3); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke();
  g.font = '700 14px Archivo, Arial'; g.textAlign = 'center'; g.fillText('N', 0, 24); g.restore();
}
function drawToSat(g, x, y, bear, label) {
  // arrow pointing toward the satellite (map bearing), drawn on a north-up image
  const a = bear * D2R, L = 70, dx = Math.sin(a), dy = -Math.cos(a);
  g.save(); g.strokeStyle = '#FFB347'; g.fillStyle = '#FFB347'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(x - dx * L / 2, y - dy * L / 2); g.lineTo(x + dx * L / 2, y + dy * L / 2); g.stroke();
  const tx = x + dx * L / 2, ty = y + dy * L / 2;
  g.beginPath(); g.moveTo(tx + dx * 14, ty + dy * 14); g.lineTo(tx - dy * 10, ty + dx * 10); g.lineTo(tx + dy * 10, ty - dx * 10); g.closePath(); g.fill();
  g.font = '600 18px Archivo, Arial'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)';
  g.strokeText('to the ' + label, x, y + 46); g.fillText('to the ' + label, x, y + 46); g.restore();
}
function drawPanamint() {
  if (!PAN.ready) return;
  const cv = $('pv'), g = cv.getContext('2d'), W = cv.width;
  g.imageSmoothingEnabled = true; g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  const L = PAN.L[$('pl').value], R = PAN.L[$('pr').value], xd = Math.round(divider * W);
  g.drawImage(L, 0, 0, W, W);
  g.save(); g.beginPath(); g.rect(xd, 0, W - xd, W); g.clip(); g.drawImage(R, 0, 0, W, W); g.restore();
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(xd, 0); g.lineTo(xd, W); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(xd, W / 2, 9, 0, 2 * Math.PI); g.fill();
  const tag = (txt, x, al) => { g.font = '600 15px Archivo, Arial'; g.textAlign = al; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(txt, x, 24); g.fillStyle = '#fff'; g.fillText(txt, x, 24); };
  if (xd > 60) tag(short($('pl').value), 10, 'left'); if (xd < W - 60) tag(short($('pr').value), W - 10, 'right');
  drawNorth(g, W - 30, 62); drawToSat(g, W - 110, W - 110, PAN.meta.sat_bearing_deg, 'satellite (ENE)');
  // scale bar, 5 km
  const px5 = W / 20 * 5; g.fillStyle = '#fff'; g.fillRect(20, W - 30, px5, 6); g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(20, W - 30, px5, 6);
  g.font = '600 14px Archivo, Arial'; g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText('5 km', 20, W - 38); g.fillText('5 km', 20, W - 38);
  $('psv').textContent = Math.round(divider * 100) + '%';
  const lg = [$('pl').value, $('pr').value];
  $('plegend').innerHTML = lg.includes('loc') ? locLegend(PAN.meta.incidence) : lg.includes('hgt') ? '<span>height 131 m</span><span class="bar" style="background:linear-gradient(90deg,rgb(40,70,60),rgb(110,130,85),rgb(190,170,120),rgb(150,115,90),rgb(235,230,225))"></span><span>3,357 m</span>' : '';
}
const short = k => ({ gslc: 'GSLC: before', gcov: 'GCOV: after', loc: 'local incidence', hgt: 'height', sim: 'simulated' })[k];
['pl', 'pr'].forEach(id => $(id).addEventListener('input', drawPanamint));
$('ps').addEventListener('input', e => { divider = e.target.value / 100; drawPanamint(); });
(function () {
  const cv = $('pv'); let drag = false;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener('pointerdown', e => { const [x] = pos(e); if (Math.abs(x - divider) < 0.04) { drag = true; cv.setPointerCapture(e.pointerId); } });
  cv.addEventListener('pointerup', () => { drag = false; });
  cv.addEventListener('pointermove', e => {
    const [x, y] = pos(e);
    if (drag) { divider = Math.max(0, Math.min(1, x)); $('ps').value = Math.round(divider * 100); drawPanamint(); }
    cv.style.cursor = Math.abs(x - divider) < 0.04 ? 'ew-resize' : 'crosshair';
    if (!PAN.ready) return;
    const n = PAN.n, j = Math.min(n - 1, Math.max(0, Math.floor(x * n))), i = Math.min(n - 1, Math.max(0, Math.floor(y * n))), k = i * n + j;
    const inc = PAN.meta.incidence, li = PAN.li[k];
    const side = li < inc - 2 ? 'faces the radar' : li > inc + 2 ? 'faces away' : 'about level, or tilted along the track';
    $('phov').innerHTML = `height ${Math.round(PAN.h[k])} m · slope ${PAN.sl[k]}° · local incidence ${li}° (${side})<br>GSLC ${isNaN(PAN.g[k]) ? 'no data' : PAN.g[k].toFixed(1) + ' dB'} · GCOV ${isNaN(PAN.c[k]) ? 'no data' : PAN.c[k].toFixed(1) + ' dB'}`;
  });
})();
function median(a) { if (!a.length) return NaN; a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]); }
function measure() {
  if (!PAN.ready) return;
  const ms = +$('msl').value, mg = +$('mmg').value, inc = PAN.meta.incidence;
  $('mslv').textContent = ms + '°'; $('mmgv').textContent = mg + '°';
  const fg = [], ag = [], fc = [], ac = [];
  for (let k = 0; k < PAN.g.length; k++) {
    if (isNaN(PAN.g[k]) || isNaN(PAN.c[k]) || PAN.li[k] <= 5 || PAN.sl[k] < ms) continue;
    if (PAN.li[k] <= inc - mg) { fg.push(PAN.g[k]); fc.push(PAN.c[k]); } else if (PAN.li[k] >= inc + mg) { ag.push(PAN.g[k]); ac.push(PAN.c[k]); }
  }
  const nf = fg.length, na = ag.length;
  const dg = median(fg) - median(ag), dc = median(fc) - median(ac);
  $('m-g').textContent = isNaN(dg) ? 'n/a' : sgn(dg) + ' dB'; $('m-c').textContent = isNaN(dc) ? 'n/a' : sgn(dc) + ' dB';
  $('m-n').textContent = `${nf.toLocaleString()} facing and ${na.toLocaleString()} away cells of 40 m (of ${PAN.g.length.toLocaleString()})`;
  drawChart();
}
$('msl').addEventListener('input', measure); $('mmg').addEventListener('input', measure);
function drawChart() {
  const svg = $('chart'); while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!PAN.ready) return;
  const ms = +$('msl').value, inc = PAN.meta.incidence;
  const W = 520, H = 330, l = 52, r = 14, t = 16, b = 46, x0 = 0, x1 = 90, y0 = -16, y1 = 10;
  const X = v => l + (v - x0) / (x1 - x0) * (W - l - r), Y = v => t + (y1 - v) / (y1 - y0) * (H - t - b);
  const muted = css('--muted'), rule = css('--rule'), ink = css('--ink');
  for (let v = y0; v <= y1; v += 2) { el('line', { x1: l, x2: W - r, y1: Y(v), y2: Y(v), stroke: css('--rule-soft') }, svg); el('text', { x: l - 6, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: muted }, svg, v); }
  for (let v = 0; v <= 90; v += 15) el('text', { x: X(v), y: H - b + 16, 'text-anchor': 'middle', 'font-size': 11, fill: muted }, svg, v + '°');
  el('text', { x: (l + W - r) / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 12, fill: muted }, svg, 'local incidence angle');
  el('text', { x: 14, y: (t + H - b) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: muted, transform: `rotate(-90 14 ${(t + H - b) / 2})` }, svg, 'median brightness (dB)');
  el('line', { x1: X(inc), x2: X(inc), y1: t, y2: H - b, stroke: css('--inc'), 'stroke-dasharray': '4 3' }, svg);
  el('text', { x: X(inc) + 4, y: t + 12, 'font-size': 11, fill: css('--inc') }, svg, 'θ = ' + fmt(inc) + '° (level ground)');
  el('line', { x1: l, x2: l, y1: t, y2: H - b, stroke: rule }, svg); el('line', { x1: l, x2: W - r, y1: H - b, y2: H - b, stroke: rule }, svg);
  const bins = []; for (let a = 5; a < 85; a += 5) bins.push([a, [], []]);
  for (let k = 0; k < PAN.g.length; k++) {
    if (isNaN(PAN.g[k]) || isNaN(PAN.c[k]) || PAN.sl[k] < ms) continue;
    const j = Math.floor((PAN.li[k] - 5) / 5); if (j < 0 || j >= bins.length) continue;
    bins[j][1].push(PAN.g[k]); bins[j][2].push(PAN.c[k]);
  }
  const ser = (idx, col) => {
    const pts = bins.filter(q => q[idx].length >= 50).map(q => [q[0] + 2.5, median(q[idx])]);
    el('polyline', { points: pts.map(p => `${X(p[0])},${Y(p[1])}`).join(' '), fill: 'none', stroke: col, 'stroke-width': 2.5 }, svg);
    pts.forEach(p => el('circle', { cx: X(p[0]), cy: Y(p[1]), r: 3.2, fill: col }, svg));
    return pts;
  };
  const gp = ser(1, css('--los')); ser(2, css('--track'));
  // teaching model for range-tilted slopes, pinned to the GSLC median at the incidence angle
  let ref = NaN; for (let i = 1; i < gp.length; i++) if (gp[i - 1][0] <= inc && gp[i][0] >= inc) ref = gp[i - 1][1] + (gp[i][1] - gp[i - 1][1]) * (inc - gp[i - 1][0]) / (gp[i][0] - gp[i - 1][0]);
  if (!isNaN(ref)) {
    const th = inc * D2R; let d = '';
    for (let a = 6; a <= 84; a += 1) {
      const L = a * D2R, v = ref + 10 * Math.log10((Math.cos(L) ** 2 / Math.cos(th) ** 2) * (Math.sin(th) / Math.sin(L)));
      if (v < y0 || v > y1) continue; d += (d ? 'L' : 'M') + X(a) + ',' + Y(v);
    }
    el('path', { d, fill: 'none', stroke: ink, 'stroke-width': 1.5, 'stroke-dasharray': '6 4', opacity: 0.7 }, svg);
  }
  const lg = [[css('--los'), 'GSLC (before)'], [css('--track'), 'GCOV (after)'], [ink, 'teaching model']];
  lg.forEach(([c, s], i) => { el('line', { x1: W - 150, x2: W - 128, y1: t + 14 + 16 * i + 10, y2: t + 14 + 16 * i + 10, stroke: c, 'stroke-width': 2.5, 'stroke-dasharray': i === 2 ? '6 4' : '' }, svg); el('text', { x: W - 122, y: t + 14 + 16 * i + 14, 'font-size': 11.5, fill: muted }, svg, s); });
}

// ------------------------------------------------------------------ part 3: DEM simulator
const SIM = { sites: null, cache: {}, cur: null, last: null };
async function loadTile(m) {
  const key = m.file; if (SIM.cache[key]) return SIM.cache[key];
  const im = await loadImg('data/' + m.file), px = pixels(im), n = m.w * m.h, h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = m.min + ((px[4 * i] << 8) + px[4 * i + 1]) / 65535 * (m.max - m.min);
  return (SIM.cache[key] = { h, w: m.w, rows: m.h, dx: m.dx, min: m.min, max: m.max, meta: m });
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gamma4(r) { let s = 0; for (let i = 0; i < 4; i++) s -= Math.log(1 - r()); return s / 4; } // mean 1, 4 looks

/* simulate(tile, geo, opts): geo = {inc (deg), b (bearing to the satellite, deg), head (heading, deg)}
   returns per-cell cosL, np, shadow, slope, aspect, the radar-geometry image and the map image (dB rel. level). */
function simulate(T, geo, opts) {
  const W = T.w, Hn = T.rows, dx = T.dx, z = T.h, n = W * Hn;
  const th = geo.inc * D2R, sT = Math.sin(th), cT = Math.cos(th), cot = cT / sT, b = geo.b * D2R, H = geo.head * D2R;
  const l = [sT * Math.sin(b), sT * Math.cos(b), cT], p = [-cT * Math.sin(b), -cT * Math.cos(b), sT];
  const cosL = new Float32Array(n), np = new Float32Array(n), nz = new Float32Array(n), shadow = new Uint8Array(n), slope = new Float32Array(n), aspect = new Float32Array(n);
  let zmax = -1e9; for (let i = 0; i < n; i++) zmax = Math.max(zmax, z[i]);
  for (let i = 0; i < Hn; i++) for (let j = 0; j < W; j++) {
    const k = i * W + j, jl = Math.max(0, j - 1), jr = Math.min(W - 1, j + 1), iu = Math.max(0, i - 1), id = Math.min(Hn - 1, i + 1);
    const dE = (z[i * W + jr] - z[i * W + jl]) / ((jr - jl) * dx), dN = -(z[id * W + j] - z[iu * W + j]) / ((id - iu) * dx);
    const nx = -dE, ny = -dN, L = Math.hypot(nx, ny, 1);
    cosL[k] = (nx * l[0] + ny * l[1] + l[2]) / L; np[k] = (nx * p[0] + ny * p[1] + p[2]) / L; nz[k] = 1 / L;
    slope[k] = Math.atan(Math.hypot(dE, dN)) * R2D; aspect[k] = mod360(Math.atan2(nx, ny) * R2D);
  }
  // shadow: march from each cell toward the satellite; the ray climbs cot(theta) per metre
  const sj = Math.sin(b), si = -Math.cos(b), rise = dx * cot;
  for (let i = 0; i < Hn; i++) for (let j = 0; j < W; j++) {
    const k = i * W + j; if (cosL[k] <= 0) { shadow[k] = 1; continue; }
    let y = i, x = j, hr = z[k];
    for (let s = 1; s < 4000; s++) {
      y += si; x += sj; hr += rise; if (hr > zmax) break;
      const yi = Math.round(y), xi = Math.round(x); if (yi < 0 || yi >= Hn || xi < 0 || xi >= W) break;
      if (z[yi * W + xi] > hr + 0.5) { shadow[k] = 1; break; }
    }
  }
  // radar geometry: lines of constant azimuth, sampled every half cell, echoes binned by slant range
  const D = Math.hypot(W, Hn) * dx / 2, cx = (W - 1) / 2, cy = (Hn - 1) / 2;
  const dr = dx * sT, rmin = -D * sT - zmax * cT - dx, rmax = D * sT - T.min * cT + dx;
  const Rn = Math.ceil((rmax - rmin) / dr) + 1, Tn = Math.ceil(2 * D / dx) + 1;
  const radar = new Float32Array(Rn * Tn), hit = new Uint8Array(Rn * Tn);
  const bil = (arr, fy, fx) => {
    const y0 = Math.floor(fy), x0 = Math.floor(fx), ty = fy - y0, tx = fx - x0, k = y0 * W + x0;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - ty) + (arr[k + W] * (1 - tx) + arr[k + W + 1] * tx) * ty;
  };
  const sig0 = new Float32Array(n); for (let k = 0; k < n; k++) sig0[k] = shadow[k] || cosL[k] <= 0 ? 0 : cosL[k] * cosL[k] / nz[k];
  const sH = Math.sin(H), cH = Math.cos(H);
  for (let ti = 0; ti < Tn; ti++) {
    const t = -D + ti * dx;
    for (let si2 = 0; si2 <= 4 * D / dx; si2++) {
      const s = -D + si2 * dx / 2;
      const E = t * sH + s * Math.sin(b), Nn = t * cH + s * Math.cos(b);
      const fx = cx + E / dx, fy = cy - Nn / dx;
      if (fx < 0 || fy < 0 || fx >= W - 1 || fy >= Hn - 1) continue;
      const h = bil(z, fy, fx), w = bil(sig0, fy, fx) * 0.5;
      const rb = (-s * sT - h * cT - rmin) / dr, r0 = Math.floor(rb), f = rb - r0;
      if (r0 < 0 || r0 + 1 >= Rn) continue;
      radar[ti * Rn + r0] += w * (1 - f); radar[ti * Rn + r0 + 1] += w * f; hit[ti * Rn + r0] = 1; hit[ti * Rn + r0 + 1] = 1;
    }
  }
  const lvl = cT * cT, R = opts.speckle ? rng(opts.seed || 1) : null;
  const radarDB = new Float32Array(Rn * Tn);
  for (let q = 0; q < Rn * Tn; q++) {
    let v = radar[q] / lvl; if (R) v *= gamma4(R);
    radarDB[q] = hit[q] ? (v > 1e-4 ? 10 * Math.log10(v) : -40) : NaN;
  }
  // map image: each cell takes the value of the radar cell its echo lands in
  const mapDB = new Float32Array(n);
  for (let i = 0; i < Hn; i++) for (let j = 0; j < W; j++) {
    const E = (j - cx) * dx, Nn = (cy - i) * dx, k = i * W + j;
    const t = E * sH + Nn * cH, s = E * Math.sin(b) + Nn * Math.cos(b);
    const ti = Math.round((t + D) / dx), rb = Math.round((-s * sT - z[k] * cT - rmin) / dr);
    mapDB[k] = ti >= 0 && ti < Tn && rb >= 0 && rb < Rn ? radarDB[ti * Rn + rb] : NaN;
  }
  let nl = 0, ns = 0, nf = 0;
  for (let k = 0; k < n; k++) { if (np[k] <= 0) nl++; if (shadow[k]) ns++; if (cosL[k] > cT && np[k] > 0 && !shadow[k]) nf++; }
  return { cosL, np, nz, shadow, slope, aspect, radarDB, Rn, Tn, mapDB, stats: { lay: nl / n, sha: ns / n, fac: nf / n } };
}

async function initSim() {
  SIM.sites = await fetch('data/sites.json').then(r => r.json());
  const seen = {};
  for (const k in SIM.sites) { const m = SIM.sites[k]; if (seen[m.site]) continue; seen[m.site] = 1; const o = document.createElement('option'); o.value = m.site; o.textContent = m.name; $('site').appendChild(o); }
  $('site').addEventListener('input', () => drawSim(true)); $('view').addEventListener('input', () => drawSim(false)); $('speck').addEventListener('input', () => drawSim(true));
  $('dem').querySelectorAll('button').forEach(bt => bt.addEventListener('click', () => { SIM.dem = bt.dataset.v; drawSim(true); }));
  SIM.dem = HASH.dem === '3dep' ? '3dep' : 'cop30';
  if (HASH.site && SIM.sites[HASH.site + '_cop30'] || SIM.sites[(HASH.site || '') + '_3dep']) $('site').value = HASH.site;
  drawSim(true);
}
async function drawSim(recompute) {
  if (!SIM.sites) return;
  const site = $('site').value;
  let key = site + '_' + SIM.dem; if (!SIM.sites[key]) key = site + '_' + (SIM.dem === 'cop30' ? '3dep' : 'cop30');
  const m = SIM.sites[key];
  $('dem').querySelectorAll('button').forEach(bt => { bt.classList.toggle('on', site + '_' + bt.dataset.v === key); bt.disabled = !SIM.sites[site + '_' + bt.dataset.v]; bt.style.opacity = bt.disabled ? 0.4 : 1; });
  const T = await loadTile(m);
  const geo = { inc: st.inc, b: satBearing(st), head: HEAD[st.pass] };
  const sig = JSON.stringify([key, geo, $('speck').checked]);
  if (recompute || !SIM.last || SIM.sig !== sig) { SIM.last = simulate(T, geo, { speckle: $('speck').checked, seed: 11 }); SIM.sig = sig; SIM.T = T; SIM.m = m; }
  const S = SIM.last, view = $('view').value, cv = $('sv'), g = cv.getContext('2d');
  const W = T.w, Hn = T.rows, n = W * Hn;
  let img, iw, ih;
  if (view === 'radar') {
    // north roughly up: range across, near range on the satellite's side; azimuth along, flipped for descending passes
    iw = S.Rn; ih = S.Tn; img = new ImageData(iw, ih);
    const satEast = Math.sin(geo.b * D2R) > 0, northward = Math.cos(geo.head * D2R) > 0;
    for (let ti = 0; ti < ih; ti++) for (let rb = 0; rb < iw; rb++) {
      const v = S.radarDB[ti * iw + rb], col = satEast ? iw - 1 - rb : rb, row = northward ? ih - 1 - ti : ti, o = 4 * (row * iw + col);
      if (isNaN(v)) { img.data.set([38, 44, 52, 255], o); continue; }
      const gr = Math.round(255 * Math.max(0, Math.min(1, (v + 12) / 22))); img.data.set([gr, gr, gr, 255], o);
    }
  } else {
    iw = W; ih = Hn; img = new ImageData(W, Hn);
    // hillshade for the masks and height views
    for (let k = 0; k < n; k++) {
      let c;
      if (view === 'map') { const v = S.mapDB[k]; const gr = isNaN(v) ? 0 : Math.round(255 * Math.max(0, Math.min(1, (v + 12) / 22))); c = [gr, gr, gr]; }
      else if (view === 'loc') { c = S.np[k] <= 0 ? [185, 60, 24] : S.cosL[k] <= 0 ? [59, 66, 99] : locColor(Math.acos(S.cosL[k]) * R2D, st.inc); if (S.shadow[k] && S.cosL[k] > 0) c = c.map(v => v * 0.45); }
      else {
        const asp = S.aspect[k] * D2R, sl = S.slope[k] * D2R, sun = 315 * D2R, el2 = 45 * D2R;
        const hs = Math.max(0, Math.cos(sl) * Math.sin(el2) + Math.sin(sl) * Math.cos(el2) * Math.cos(asp - sun));
        if (view === 'hgt') { const t = (T.h[k] - T.min) / (T.max - T.min); c = lerpCol(HGT_STOPS, t).map(v => v * (0.55 + 0.45 * hs)); }
        else { const gr = 70 + 150 * hs; c = [gr, gr, gr]; if (S.np[k] <= 0) c = [185, 60, 24]; else if (S.shadow[k]) c = [59, 66, 99]; }
      }
      img.data.set([c[0], c[1], c[2], 255], 4 * k);
    }
  }
  const off = document.createElement('canvas'); off.width = iw; off.height = ih; off.getContext('2d').putImageData(img, 0, 0);
  const CW = 700, CH = Math.round(CW * ih / iw); cv.width = CW; cv.height = CH;
  g.imageSmoothingEnabled = true; g.drawImage(off, 0, 0, CW, CH);
  if (view !== 'radar') {
    drawNorth(g, CW - 28, 40, 0.9);
    drawToSat(g, CW - 90, CH - 90, geo.b, 'satellite');
    const km = W * T.dx / 1000, barKm = km >= 15 ? 5 : km >= 6 ? 2 : 1, px = CW / km * barKm;
    g.fillStyle = '#fff'; g.fillRect(16, CH - 24, px, 5); g.font = '600 13px Archivo, Arial'; g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)';
    g.strokeText(barKm + ' km', 16, CH - 30); g.fillText(barKm + ' km', 16, CH - 30);
  } else {
    g.font = '600 13px Archivo, Arial'; g.fillStyle = '#fff'; g.textAlign = 'left';
    const satEast = Math.sin(geo.b * D2R) > 0;
    g.fillText(satEast ? '← far range' : 'near range →', 10, 20); g.textAlign = 'right'; g.fillText(satEast ? 'near range →' : '← far range', CW - 10, 20);
  }
  $('st-l').textContent = (100 * S.stats.lay).toFixed(1) + '%'; $('st-s').textContent = (100 * S.stats.sha).toFixed(1) + '%'; $('st-f').textContent = (100 * S.stats.fac).toFixed(0) + '%';
  $('st-d').textContent = Math.round(T.dx) + ' m'; $('st-ds').textContent = (m.src === 'cop30' ? 'Copernicus GLO-30 (30 m)' : 'USGS 3DEP (10 m)') + ', resampled to this grid';
  $('slegend').innerHTML = view === 'loc' ? locLegend(st.inc) + ' <span><span class="sw" style="background:rgb(185,60,24)"></span>layover <span class="sw" style="background:rgb(59,66,99)"></span>faces away past 90°; darker: cast shadow</span>'
    : view === 'mask' ? '<span><span class="sw" style="background:rgb(185,60,24)"></span>layover (slopes steeper than &theta; toward the radar) &nbsp;<span class="sw" style="background:rgb(59,66,99)"></span>shadow (self and cast)</span>'
      : view === 'hgt' ? `<span>${Math.round(T.min)} m</span><span class="bar" style="background:linear-gradient(90deg,rgb(40,70,60),rgb(110,130,85),rgb(190,170,120),rgb(150,115,90),rgb(235,230,225))"></span><span>${Math.round(T.max)} m</span>`
        : '<span>brightness relative to level ground, &minus;12 to +10 dB</span>';
  const look = `${st.pass === 'asc' ? 'Ascending' : 'Descending'}, looking ${st.look}, incidence ${fmt(st.inc)}°: the satellite is to the ${compass(geo.b)}`;
  $('scap').innerHTML = `<b>${m.name}</b>, ${m.note}. ${look}. ` + (view === 'radar'
    ? 'Radar geometry: across is slant range, drawn so that level ground keeps its map width; along is the flight direction, turned so north is roughly up (the axes sit about 15&deg; off north-south). Grey-blue: outside the elevation model.'
    : 'Map view, north up.') + ` Simulated from the elevation model with the teaching model (cos&sup2; scattering, the squeeze, layover and shadow); not a radar image. ${m.credit}.`;
}
(function () {
  const cv = $('sv');
  cv.addEventListener('pointermove', e => {
    if (!SIM.last || $('view').value === 'radar') { $('shov').textContent = $('view').value === 'radar' ? 'Radar geometry: each column is a distance from the satellite.' : ''; return; }
    const r = cv.getBoundingClientRect(), T = SIM.T, S = SIM.last;
    const j = Math.min(T.w - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * T.w))), i = Math.min(T.rows - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * T.rows))), k = i * T.w + j;
    const loc = Math.acos(Math.max(-1, Math.min(1, S.cosL[k]))) * R2D;
    const status = S.np[k] <= 0 ? 'LAYOVER' : S.shadow[k] ? 'SHADOW' : Math.abs(loc - st.inc) < 2 ? 'about level, or tilted along the track' : loc < st.inc ? 'faces the radar' : 'faces away';
    $('shov').innerHTML = `height ${Math.round(T.h[k])} m · slope ${S.slope[k].toFixed(0)}° facing ${compass(S.aspect[k])} · local incidence ${loc.toFixed(0)}° · ${status}` +
      (isNaN(S.mapDB[k]) ? '' : `<br>simulated brightness ${sgn(S.mapDB[k])} dB vs level ground`);
  });
})();

// ------------------------------------------------------------------ start
// optional set-up from the address, e.g. #inc=30&slope=45&dir=toward&look=right&pass=desc&site=rainier&dem=3dep&view=mask
const HASH = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
if (HASH.inc) st.inc = Math.max(15, Math.min(60, +HASH.inc));
if (HASH.slope) st.slope = Math.max(0, Math.min(85, +HASH.slope));
if (HASH.look === 'left' || HASH.look === 'right') st.look = HASH.look;
if (HASH.pass === 'asc' || HASH.pass === 'desc') st.pass = HASH.pass;
st.aspect = HASH.aspect ? mod360(+HASH.aspect) : satBearing(st);
if (['toward', 'away', 'along'].includes(HASH.dir)) { const b = satBearing(st); st.aspect = mod360(HASH.dir === 'toward' ? b : HASH.dir === 'away' ? b + 180 : HEAD[st.pass]); }
if (HASH.view) $('view').value = HASH.view;
if (HASH.theme === 'light' || HASH.theme === 'dark') document.documentElement.setAttribute('data-theme', HASH.theme);
if (HASH.speckle === '1') $('speck').checked = true;
updateAll();
initPanamint().catch(e => { $('phov').textContent = 'Could not load the Panamint data (' + e + '). Serve this folder over HTTP: python3 -m http.server'; });
initSim().catch(e => { $('shov').textContent = 'Could not load the elevation models (' + e + '). Serve this folder over HTTP: python3 -m http.server'; });
