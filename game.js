const T = 48, COLS = 15, ROWS = 13;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
cv.width = COLS * T;
cv.height = ROWS * T;
ctx.imageSmoothingEnabled = false; // mantiene el pixel art nítido

// ---- Sprites del jugador (hoja con 10 fotogramas de 256x256 en una fila) ----
const playerImg = new Image();
playerImg.src = 'Sprites/Jugador.png';
const SF = 256;                       // tamaño de cada fotograma en la imagen
const PLAYER = {                      // índice de fotograma (empieza en 0)
  Down:  { frames: [2, 6, 8] },
  Up:    { frames: [5, 7, 9] },
  Left:  { frames: [0, 1] },
  Right: { frames: [0, 1], flip: true }   // se refleja el de izquierda
};
const FRAME_WIN = 3, FRAME_LOSE = 4;
const WALK_FPS = 8;
let clock = 0;

// ---- Sprites Enemigos ----

const enemyImg = new Image();
enemyImg.src = 'Sprites/Enemigo1.png';
const ENEMY_FRAMES = 2;
const ENEMY_FPS = 4;

// ---- Sprites de la bomba y explosión ----
const bombSheet = new Image();
bombSheet.src = 'Sprites/Bombas.png'; // Asegúrate de que la ruta sea correcta
const BS = 256; // Tamaño de cada cuadro en el archivo original (16x16)

// Configuración de animación
const BOMB_FRAMES = [0, 1];     // Índices 0 y 1 para la bomba
const FIRE_FRAMES = [2, 3];     // Índices 2 y 3 para la animación del fuego
const ANIM_FPS = 6;             // Velocidad de cambio de fotogramas

// ---- Sprites PowerUPS ----
const powerImg = new Image();
powerImg.src = 'Sprites/PowerUPS.png';
const POWER_FRAME = { b: 0, r: 1};

// ---- Sprites Muros ----
const tilesImg = new Image();
tilesImg.src= 'Sprites/Fondo.png';

const wallImg = new Image();
wallImg.src = 'Sprites/MUROSSS.png';

const TILE = { rock: 0, tree: 1, grass: [2, 3] };  // índices en la hoja
function drawTile(i, x, y) {
  ctx.drawImage(tilesImg, i * 256, 0, 256, 256, x, y, T, T);
}

function drawFrame(i, x, y, flip) {
  ctx.save();
  if (flip) { ctx.translate(x + T, y); ctx.scale(-1, 1); x = 0; y = 0; }
  ctx.drawImage(playerImg, i * SF, 0, SF, SF, x, y, T, T);
  ctx.restore();
}
function drawPlayer(x, y, walking) {
  if (!playerImg.complete || !playerImg.naturalWidth) return false;
  const d = PLAYER[player.dir || 'Down'];
  const i = walking ? d.frames[Math.floor(clock / 1000 * WALK_FPS) % d.frames.length] : d.frames[0];
  drawFrame(i, x, y, d.flip);
  return true;
}

let grid, player, bombs, fires, enemies, items, state, level = 1;

// =====================================================================
//  SONIDO: todo se sintetiza con Web Audio (no hacen falta archivos .mp3)
// =====================================================================
const Sound = (() => {
  let ac = null, sfxG, musG, noiseBuf;
  let sfxOn = true, musicOn = true, musicWanted = false, held = false, timer = null;
  try {
    sfxOn = localStorage.getItem('bomberman_sfx') !== '0';
    musicOn = localStorage.getItem('bomberman_music') !== '0';
  } catch (e) {}
  const save = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} };
  const now = () => (ac ? ac.currentTime : 0);

  // El navegador solo permite audio después de un gesto del usuario: se llama en la primera tecla/toque
  function init() {
    if (ac) { if (ac.state === 'suspended' && !held) ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();          // evita saturación cuando explotan varias bombas
    comp.connect(ac.destination);
    sfxG = ac.createGain(); sfxG.gain.value = sfxOn ? 0.8 : 0; sfxG.connect(comp);
    musG = ac.createGain(); musG.gain.value = musicOn ? 0.35 : 0; musG.connect(comp);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (musicWanted) startLoop(0.3);
  }

  // Nota con envolvente. slide = frecuencia final (para "caídas" de tono)
  function tone(f, dur, type = 'square', vol = 0.2, slide = 0, delay = 0, dest) {
    dest = dest || sfxG;
    if (!ac || (dest === musG ? !musicOn : !sfxOn)) return;
    const t = ac.currentTime + Math.max(0, delay);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.03);
  }
  // Ruido filtrado (explosiones, siseo de la mecha, platillos)
  function noise(dur, vol, type, f0, f1, delay = 0, dest) {
    dest = dest || sfxG;
    if (!ac || (dest === musG ? !musicOn : !sfxOn)) return;
    const t = ac.currentTime + Math.max(0, delay);
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t); s.stop(t + dur + 0.03);
  }

  // ---- Musiquita de fondo (Am - F - C - G, 8 compases, 150 bpm) ----
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  const LEAD = [
    69, 72, 76, 72, 69, 72, 76, 0,     65, 69, 72, 69, 65, 69, 72, 77,
    67, 72, 76, 72, 67, 72, 76, 79,    67, 71, 74, 71, 67, 71, 74, 0,
    76, 0, 76, 74, 72, 0, 71, 69,      72, 0, 72, 71, 69, 0, 67, 65,
    67, 0, 72, 76, 79, 0, 76, 72,      74, 0, 71, 74, 79, 0, 78, 74
  ];
  const BASS = [45, 41, 48, 43, 45, 41, 48, 43];
  const STEP = 60 / 150 / 2;                         // duración de una corchea
  let nextT = 0, step = 0;

  function playStep(i, t) {
    const bar = Math.floor(i / 8) % 8, s = i % 8, d = t - ac.currentTime;
    const lead = LEAD[bar * 8 + s];
    if (lead) tone(midi(lead), STEP * 1.6, 'square', 0.07, 0, d, musG);
    const root = BASS[bar];
    tone(midi(s % 2 ? root + 12 : root), STEP * 0.9, 'triangle', 0.22, 0, d, musG);
    if (s === 0 || s === 4) tone(150, 0.12, 'sine', 0.35, 45, d, musG);          // bombo
    if (s === 2 || s === 6) noise(0.1, 0.12, 'highpass', 1800, 1800, d, musG);   // caja
    if (s % 2) noise(0.03, 0.05, 'highpass', 7000, 7000, d, musG);               // hi-hat
  }
  function pump() {
    if (!ac) return;
    while (nextT < ac.currentTime + 0.25) {
      playStep(step, Math.max(nextT, ac.currentTime));
      nextT += STEP; step++;
    }
  }
  function startLoop(delay = 0.05) {
    if (timer || !ac) return;
    nextT = ac.currentTime + delay; step = 0;
    timer = setInterval(pump, 60);
  }
  function stopLoop() { clearInterval(timer); timer = null; }

  let lastBoom = -1, lastStep = -1;
  return {
    init,
    hold(on) { held = on; if (ac) { if (on) ac.suspend(); else ac.resume(); } },   // pausa / reanuda todo
    musicStart(delay) { musicWanted = true; startLoop(delay); },
    musicStop() { musicWanted = false; stopLoop(); },
    toggleSfx()   { sfxOn = !sfxOn;     save('bomberman_sfx', sfxOn);     if (sfxG) sfxG.gain.value = sfxOn ? 0.8 : 0;    return sfxOn; },
    toggleMusic() { musicOn = !musicOn; save('bomberman_music', musicOn); if (musG) musG.gain.value = musicOn ? 0.35 : 0; return musicOn; },
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; },

    // ---- efectos ----
    place()  { tone(260, 0.12, 'square', 0.15, 130); noise(0.3, 0.14, 'highpass', 3000, 6500); },   // se enciende la mecha
    tick(p)  { tone(900 + p * 900, 0.04, 'square', 0.09); },                                       // tic-tac cada vez más rápido
    explosion() {
      const quick = now() - lastBoom < 0.08; lastBoom = now();           // explosiones en cadena: más suaves
      const v = quick ? 0.35 : 0.7;
      noise(0.7, v, 'lowpass', 2500, 80);
      tone(130, 0.5, 'sine', v, 35);
      tone(70, 0.4, 'sawtooth', v * 0.25, 30);
    },
    brick()  { noise(0.18, 0.35, 'bandpass', 1200, 300); tone(200, 0.12, 'triangle', 0.2, 90); },
    enemyDie() { tone(900, 0.35, 'sawtooth', 0.18, 120); tone(450, 0.35, 'square', 0.1, 60, 0.05); noise(0.12, 0.2, 'highpass', 2000, 2000); },
    enemyStep(v) {                                                       // pasitos graves, más fuertes si están cerca
      if (now() - lastStep < 0.09) return; lastStep = now();
      tone(110 + Math.random() * 40, 0.07, 'triangle', 0.16 * Math.max(0.15, v), 70);
    },
    power()  { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.09, 'square', 0.13, 0, i * 0.06)); },
    life()   { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.13, 0, i * 0.07)); },
    hurt()   { tone(420, 0.5, 'sawtooth', 0.25, 50); noise(0.3, 0.3, 'lowpass', 2000, 200); },
    levelStart() { [392, 523, 659].forEach((f, i) => tone(f, 0.1, 'square', 0.12, 0, i * 0.09)); },
    win() {
      const n = [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.52], [1047, 0.64]];
      n.forEach(([f, t]) => { tone(f, 0.12, 'square', 0.14, 0, t); tone(f / 2, 0.12, 'triangle', 0.18, 0, t); });
      tone(1319, 0.7, 'square', 0.14, 0, 0.8); tone(1047, 0.7, 'square', 0.09, 0, 0.8); tone(262, 0.7, 'triangle', 0.25, 0, 0.8);
    },
    lose() {
      [392, 370, 349, 330, 311, 294, 262, 196].forEach((f, i) => tone(f, i === 7 ? 0.9 : 0.22, 'square', 0.14, 0, i * 0.22));
      tone(98, 0.9, 'triangle', 0.3, 0, 7 * 0.22);
    }
  };
})();
['keydown', 'pointerdown', 'touchend', 'click'].forEach(ev => addEventListener(ev, () => Sound.init(), { passive: true }));

// =====================================================================
//  EFECTOS VISUALES: partículas, textos flotantes y temblor de pantalla
// =====================================================================
let particles = [], floaters = [], shake = 0;
let paused = false, lives = 3, levelTime = 0, timeBonus = 0;

// ---- Ajustes de jugabilidad (cámbialos a tu gusto) ----
const START_LIVES = 3, MAX_LIVES = 5;      // vidas iniciales y máximas
const INVUL_MS = 2200;                     // invulnerabilidad tras recibir un golpe
const SPEED_STEP = 0.6, MAX_SPEED_LV = 5;  // cada mejora de velocidad suma 0.6 casillas/s
const MAX_BOMBS = 6, MAX_RANGE = 8;        // topes de bombas y alcance
const PAR_SECONDS = 90, SECOND_BONUS = 10; // bonus por rapidez: 10 puntos por cada segundo bajo 90 s

// Lanza n partículas desde (px, py) en píxeles del canvas
function burst(px, py, n, colors, o = {}) {
  const sp = o.speed || 160, life = o.life || 600, g = o.grav ?? 500, sz = o.size || 5;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random() * 0.7);
    const l = life * (0.6 + Math.random() * 0.6);
    particles.push({
      x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up || 0),
      life: l, max: l, g, size: sz * (0.6 + Math.random() * 0.8),
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }
}
function floater(px, py, text, color = '#ffd166', size = 14) {
  floaters.push({ x: px, y: py, text, color, size, life: 900, max: 900 });
}
function brickDebris(x, y) {                          // al romper una roca
  const cx = x * T + T / 2, cy = y * T + T / 2;
  burst(cx, cy, 12, ['#9aa0a6', '#7b8087', '#b9b2a0', '#5d544a'], { speed: 200, life: 700, grav: 700, size: 7, up: 80 });
  burst(cx, cy, 6, ['#d9d2c0', '#bdb6a4'], { speed: 60, life: 450, grav: -40, size: 10 });   // polvo
}
function enemyDeathFX(e, pts) {                       // al matar un enemigo
  const px = (e.vx ?? e.x) * T + T / 2, py = (e.vy ?? e.y) * T + T / 2;
  burst(px, py, 22, ['#9b5de5', '#c77dff', '#ffffff', '#ef476f'], { speed: 240, life: 650, grav: 300, size: 6 });
  floater(px, py - 10, '+' + pts, '#ffd166', 14);
}

function updateFX(dt) {
  const s = dt / 1000;
  for (const p of particles) { p.life -= dt; p.vy += p.g * s; p.x += p.vx * s; p.y += p.vy * s; }
  particles = particles.filter(p => p.life > 0);
  for (const f of floaters) f.life -= dt;
  floaters = floaters.filter(f => f.life > 0);
  shake = Math.max(0, shake - dt * 0.03);
}

function drawFX() {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), Math.ceil(p.size), Math.ceil(p.size));
  }
  ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  for (const f of floaters) {
    const k = 1 - f.life / f.max;                                  // 0 -> 1
    const rise = 38 * (1 - Math.pow(1 - k, 2));                    // sube frenando
    ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    ctx.font = f.size + 'px "Press Start 2P", "Courier New", monospace';
    const w = ctx.measureText(f.text).width;
    const x = Math.min(Math.max(f.x, w / 2 + 4), cv.width - w / 2 - 4);
    ctx.lineWidth = 4; ctx.strokeStyle = '#0d1020'; ctx.strokeText(f.text, x, f.y - rise);
    ctx.fillStyle = f.color; ctx.fillText(f.text, x, f.y - rise);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'start';
}

// Mejoras sin sprite propio (velocidad y vida) y respaldo de las demás
function pickItem() { const r = Math.random(); return r < 0.35 ? 'r' : r < 0.7 ? 'b' : r < 0.9 ? 's' : 'h'; }
function drawItemFallback(type, x, y) {
  const cx = x * T + T / 2, cy = y * T + T / 2 + Math.sin(clock / 250) * 2;
  const col = { r: '#ef476f', b: '#06d6a0', s: '#ffd166', h: '#ef476f' }[type];
  ctx.fillStyle = '#0d1020'; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
  ctx.fillStyle = col;
  if (type === 's') {                                    // rayo
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 12); ctx.lineTo(cx - 7, cy + 2); ctx.lineTo(cx - 1, cy + 2);
    ctx.lineTo(cx - 3, cy + 12); ctx.lineTo(cx + 7, cy - 3); ctx.lineTo(cx + 1, cy - 3);
    ctx.closePath(); ctx.fill();
  } else if (type === 'h') {                             // corazón
    ctx.beginPath(); ctx.moveTo(cx, cy + 9);
    ctx.bezierCurveTo(cx - 14, cy - 1, cx - 8, cy - 12, cx, cy - 5);
    ctx.bezierCurveTo(cx + 8, cy - 12, cx + 14, cy - 1, cx, cy + 9);
    ctx.fill();
  } else { ctx.beginPath(); ctx.arc(cx, cy, 8, 0, 7); ctx.fill(); }
}
const keys = new Set();

// ---- Puntuación ----
const ENEMY_POINTS = 100;   // puntos por cada enemigo eliminado
const LEVEL_POINTS = 500;   // puntos por pasar de nivel
const SCORE_KEY = 'bomberman_scores';
const MAX_SCORES = 10;      // cuántas partidas se muestran en la tabla
let score = 0, kills = 0;

function loadScores() {
  try { return JSON.parse(localStorage.getItem(SCORE_KEY)) || []; }
  catch (e) { return []; }
}
function saveScores(list) {
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(list)); } catch (e) {}
}
function renderScores(highlightId) {
  const body = document.getElementById('scoreBody');
  const list = loadScores();
  body.innerHTML = '';
  if (!list.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6; td.className = 'empty'; td.textContent = 'Aún no hay partidas guardadas.';
    tr.appendChild(td); body.appendChild(tr);
    return;
  }
  list.forEach((s, i) => {
    const tr = document.createElement('tr');
    if (s.id === highlightId) tr.className = 'mine';
    [i + 1, s.name, s.level, s.score, s.kills, s.date].forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;            // textContent: el nombre nunca se interpreta como HTML
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

// ---- Movimiento fluido del jugador ----
const PLAYER_SPEED = 5;     // casillas por segundo (súbelo para un personaje más rápido)
const HALF = 0.36;          // mitad del "cuerpo": ocupa el 72% de una casilla, así cabe bien por los pasillos
const DIRS = { Left: [-1, 0], Right: [1, 0], Up: [0, -1], Down: [0, 1] };
const DIRKEY = { ArrowLeft: 'Left', a: 'Left', ArrowRight: 'Right', d: 'Right',
                 ArrowUp: 'Up', w: 'Up', ArrowDown: 'Down', s: 'Down' };
const dirStack = [];        // direcciones pulsadas; manda la última que pulsaste
function dirOn(d)  { if (d && !dirStack.includes(d)) dirStack.push(d); }
function dirOff(d) { const i = dirStack.indexOf(d); if (i >= 0) dirStack.splice(i, 1); }

// ¿el cuerpo del jugador, centrado en (cx, cy), choca con algo?
function bodyBlocked(cx, cy) {
  const x0 = Math.floor(cx - HALF), x1 = Math.floor(cx + HALF - 1e-6);
  const y0 = Math.floor(cy - HALF), y1 = Math.floor(cy + HALF - 1e-6);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!grid[ty] || grid[ty][tx] !== 0) return true;                        // muro o ladrillo
      if (bombs.some(b => b.solid && b.x === tx && b.y === ty)) return true;   // bomba ya sólida
    }
  }
  return false;
}

// Un paso pequeño. Si choca contra una esquina, se desliza hacia el centro del pasillo.
function stepBody(p, dx, dy, s) {
  const nx = p.cx + dx * s, ny = p.cy + dy * s;
  if (!bodyBlocked(nx, ny)) { p.cx = nx; p.cy = ny; return true; }
  if (dx) {                                   // va en horizontal: ajusta la fila
    const diff = Math.floor(p.cy) + 0.5 - p.cy;
    if (Math.abs(diff) > 1e-4) {
      const m = Math.sign(diff) * Math.min(Math.abs(diff), s);
      if (!bodyBlocked(p.cx, p.cy + m)) { p.cy += m; return true; }
    }
  } else {                                    // va en vertical: ajusta la columna
    const diff = Math.floor(p.cx) + 0.5 - p.cx;
    if (Math.abs(diff) > 1e-4) {
      const m = Math.sign(diff) * Math.min(Math.abs(diff), s);
      if (!bodyBlocked(p.cx + m, p.cy)) { p.cx += m; return true; }
    }
  }
  return false;
}

function movePlayer(dt) {
  const dir = dirStack[dirStack.length - 1];
  if (!dir) return;
  player.dir = dir;
  const [dx, dy] = DIRS[dir];
  const total = (PLAYER_SPEED + player.speedLv * SPEED_STEP) * dt / 1000;
  const n = Math.max(1, Math.ceil(total / 0.03)), s = total / n;   // pasos pequeños: no atraviesa muros
  let moved = false;
  for (let i = 0; i < n; i++) { if (stepBody(player, dx, dy, s)) moved = true; else break; }
  if (moved) player.lastMove = clock;
}

function overlapsTile(b) {
  return Math.abs(player.cx - (b.x + 0.5)) < 0.5 + HALF && Math.abs(player.cy - (b.y + 0.5)) < 0.5 + HALF;
}

// ---- Niveles y enemigos ----
const BRICK_DENSITY = 0.65;      // probabilidad de ladrillo en cada casilla libre (0 a 1)
const ENEMY_CLEAR_RADIUS = 2;    // casillas que se despejan alrededor de cada enemigo al empezar
const MAX_ENEMIES = 7;           // tope de enemigos por nivel
const ENEMY_CHASE = 0.25;        // probabilidad de ir hacia el jugador si está cerca (0 = nunca persiguen)
const CHASE_RANGE = 5;           // a cuántas casillas "ven" al jugador
const DANGER_MS = 1000;          // evitan casillas de bombas que explotan en menos de este tiempo
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Quita los ladrillos a menos de r casillas (en línea recta) de un punto
function clearAround(cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (Math.abs(x - cx) + Math.abs(y - cy) <= r && grid[y] && grid[y][x] === 2) grid[y][x] = 0;
}

// Coloca n enemigos en cruces del mapa, lejos del jugador y separados entre sí,
// y les despeja espacio alrededor para que no nazcan encerrados.
function spawnEnemies(n) {
  const spots = [];
  for (let y = 1; y < ROWS - 1; y += 2)
    for (let x = 1; x < COLS - 1; x += 2)
      if (x + y >= 10) spots.push({ x, y });             // lejos de la salida del jugador (1,1)
  for (let i = spots.length - 1; i > 0; i--) {            // mezclar
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const list = [];
  for (let gap = 4; gap >= 0 && list.length < n; gap -= 2) {   // primero bien separados; si no caben, más juntos
    for (const s of spots) {
      if (list.length >= n) break;
      if (list.some(e => e.x === s.x && e.y === s.y)) continue;
      if (list.every(e => Math.abs(e.x - s.x) + Math.abs(e.y - s.y) >= gap)) {
        list.push({ x: s.x, y: s.y, dir: DIR4[Math.floor(Math.random() * 4)], t: 0 });
      }
    }
  }
  for (const e of list) clearAround(e.x, e.y, ENEMY_CLEAR_RADIUS);
  return list;
}

// Casillas que alcanzaría la explosión de una bomba (los ladrillos la detienen)
function blastCells(b) {
  const cells = [{ x: b.x, y: b.y }];
  for (const [dx, dy] of DIR4) {
    for (let i = 1; i <= b.range; i++) {
      const x = b.x + dx * i, y = b.y + dy * i;
      if (grid[y][x] === 1) break;
      cells.push({ x, y });
      if (grid[y][x] === 2) break;
    }
  }
  return cells;
}

// Casillas peligrosas para los enemigos: con fuego ahora, o que lo tendrán muy pronto
function dangerCells() {
  const set = new Set();
  for (const f of fires) set.add(f.x + ',' + f.y);
  for (const b of bombs) if (b.t < DANGER_MS) for (const c of blastCells(b)) set.add(c.x + ',' + c.y);
  return set;
}

// Un paso de un enemigo
function enemyStep(e, danger) {
  const opts = DIR4.filter(([dx, dy]) => free(e.x + dx, e.y + dy));
  const safe = opts.filter(([dx, dy]) => !danger.has((e.x + dx) + ',' + (e.y + dy)));
  if (!safe.length) return;                                   // sin salida segura: espera quieto

  // no da media vuelta salvo que no tenga otra opción
  const ahead = safe.filter(d => !(d[0] === -e.dir[0] && d[1] === -e.dir[1]));
  const pool = ahead.length ? ahead : safe;

  let dir;
  const toPlayer = d => Math.abs(player.x - (e.x + d[0])) + Math.abs(player.y - (e.y + d[1]));
  const dist = Math.abs(player.x - e.x) + Math.abs(player.y - e.y);
  const straight = pool.find(d => d[0] === e.dir[0] && d[1] === e.dir[1]);
  if (player.alive && dist <= CHASE_RANGE && Math.random() < ENEMY_CHASE) {
    dir = safe.slice().sort((a, b) => toPlayer(a) - toPlayer(b))[0];     // se acerca al jugador
  } else if (straight && Math.random() > 0.2) {
    dir = straight;                                                       // sigue recto
  } else {
    dir = pool[Math.floor(Math.random() * pool.length)];                  // gira al azar
  }
  e.dir = dir;
  e.x += dir[0]; e.y += dir[1];
}

function reset(newLevel) {
  if (newLevel) { level = 1; score = 0; kills = 0; lives = START_LIVES; hideSaveBox(); }
  hideEnd();
  grid = [];
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < COLS; x++) {
      const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      const safe = x + y <= 3;
      grid[y][x] = (border || pillar) ? 1 : (!safe && Math.random() < BRICK_DENSITY ? 2 : 0);
    }
  }
  player = { x: 1, y: 1, cx: 1.5, cy: 1.5, alive: true, maxBombs: 1, range: 2, speedLv: 0, invul: 0 };   // cx, cy = centro en casillas
  bombs = []; fires = []; items = {};
  enemies = spawnEnemies(Math.min(2 + level, MAX_ENEMIES));
  state = 'play';
  particles = []; floaters = []; shake = 0; levelTime = 0; timeBonus = 0;
  if (paused) { paused = false; Sound.hold(false); }
  hud();
  Sound.musicStart(0.6);
  Sound.levelStart();
}

// Cambia el valor de una estadística y le da un pequeño "salto" visual
function setStat(id, v) {
  const el = document.getElementById(id);
  if (el.textContent === String(v)) return;
  el.textContent = v;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
function hud() {
  setStat('hScore', String(score).padStart(6, '0'));   // 000600, estilo arcade
  setStat('hLevel', level);
  setStat('hBombs', player.maxBombs);
  setStat('hRange', player.range);
  setStat('hEnemies', enemies.length);
  setStat('hLives', lives);
}

const bombAt = (x, y) => bombs.find(b => b.x === x && b.y === y);
const free = (x, y) => grid[y] && grid[y][x] === 0 && !bombAt(x, y);

function placeBomb() {
  if (state !== 'play' || !player.alive) return;
  if (bombs.length >= player.maxBombs || bombAt(player.x, player.y)) return;
  bombs.push({ x: player.x, y: player.y, t: 2000, range: player.range, solid: false, nextTick: 1750 });
  Sound.place();
}

function explode(b) {
  if (!bombs.includes(b)) return;
  bombs.splice(bombs.indexOf(b), 1);
  let broke = false;
  for (const c of blastCells(b)) {
    fires.push({ x: c.x, y: c.y, t: 450 });
    const other = bombAt(c.x, c.y);
    if (other) other.t = 0;                         // reacción en cadena
    if (grid[c.y][c.x] === 2) {
      grid[c.y][c.x] = 0;
      broke = true;
      brickDebris(c.x, c.y);                        // partículas de la roca
      if (Math.random() < 0.25) items[c.x + ',' + c.y] = pickItem();
    }
    burst(c.x * T + T / 2, c.y * T + T / 2, 3, ['#ffd166', '#ef9a3c', '#ff6b35'], { speed: 140, life: 400, grav: 0, size: 4 });
  }
  Sound.explosion();
  if (broke) Sound.brick();
  shake = Math.max(shake, 4 + Math.min(b.range, 6) * 0.5);
}

// Efecto de recoger una mejora
function collect(type) {
  const px = player.cx * T, py = player.cy * T - 12;
  if (type === 'r') { player.range = Math.min(MAX_RANGE, player.range + 1); floater(px, py, '+ALCANCE', '#ef476f', 10); Sound.power(); }
  else if (type === 'b') { player.maxBombs = Math.min(MAX_BOMBS, player.maxBombs + 1); floater(px, py, '+BOMBA', '#06d6a0', 10); Sound.power(); }
  else if (type === 's') { player.speedLv = Math.min(MAX_SPEED_LV, player.speedLv + 1); floater(px, py, '+VELOCIDAD', '#ffd166', 10); Sound.power(); }
  else if (type === 'h') { lives = Math.min(MAX_LIVES, lives + 1); floater(px, py, '+VIDA', '#ef476f', 10); Sound.life(); }
}

// El jugador recibe un golpe: pierde una vida y queda invulnerable un rato
function hurtPlayer() {
  lives--;
  burst(player.cx * T, player.cy * T, 18, ['#eef1f8', '#ef476f', '#ffd166'], { speed: 220, life: 700, grav: 400, size: 6 });
  shake = Math.max(shake, 8);
  if (lives > 0) {
    player.invul = INVUL_MS;
    floater(player.cx * T, player.cy * T - 12, '-1 VIDA', '#ef476f', 12);
    Sound.hurt();
    hud();
  } else {
    player.alive = false;
    state = 'lose';
    hud();
    Sound.musicStop(); Sound.hurt(); Sound.lose();
    showEnd(false);
    showSaveBox();
  }
}

function update(dt) {
  if (state !== 'play' || paused) return;
  levelTime += dt;
  if (player.invul > 0) player.invul -= dt;

  // jugador
  if (player.alive) {
    movePlayer(dt);
    player.x = Math.floor(player.cx);             // casilla donde está su centro
    player.y = Math.floor(player.cy);
    // una bomba recién puesta se vuelve sólida cuando el jugador termina de salir de ella
    for (const b of bombs) if (!b.solid && !overlapsTile(b)) b.solid = true;
    const k = player.x + ',' + player.y;
    if (items[k]) {
      collect(items[k]);
      delete items[k];
      hud();
    }
  }

  // bombas (con tic-tac que se acelera) y fuego
  for (const b of [...bombs]) {
    b.t -= dt;
    if (b.t <= 0) { explode(b); continue; }
    if (b.t <= b.nextTick) {
      Sound.tick(1 - b.t / 2000);
      b.nextTick = b.t - (110 + 290 * b.t / 2000);
    }
  }
  fires.forEach(f => f.t -= dt);
  fires = fires.filter(f => f.t > 0);
  const onFire = (x, y) => fires.some(f => f.x === x && f.y === y);

  // enemigos
  const speed = Math.max(250, 450 - level * 25);
  const danger = dangerCells();
  for (const e of enemies) {
    e.t += dt;
    if (e.t < speed) continue;
    e.t = 0;
    const ox = e.x, oy = e.y;
    enemyStep(e, danger);
    if (player.alive && (e.x !== ox || e.y !== oy)) {                // sonido de pasos si están cerca
      const dist = Math.abs(player.x - e.x) + Math.abs(player.y - e.y);
      if (dist <= 6) Sound.enemyStep(1 - dist / 7);
    }
  }

  // enemigos eliminados: combo si caen varios con la misma explosión
  const dead = enemies.filter(e => onFire(e.x, e.y));
  if (dead.length) {
    enemies = enemies.filter(e => !dead.includes(e));
    const pts = ENEMY_POINTS * dead.length;                           // 1 enemigo = 100, 2 a la vez = 200 c/u...
    for (const e of dead) enemyDeathFX(e, pts);
    if (dead.length > 1) floater(cv.width / 2, 40, 'COMBO x' + dead.length, '#06d6a0', 14);
    kills += dead.length; score += pts * dead.length;
    Sound.enemyDie();
    hud();
  }

  // golpes al jugador (con invulnerabilidad temporal)
  if (player.alive && player.invul <= 0 &&
      (onFire(player.x, player.y) || enemies.some(e => Math.hypot(player.cx - ((e.vx ?? e.x) + 0.5), player.cy - ((e.vy ?? e.y) + 0.5)) < 0.6))) {
    hurtPlayer();
  }

  if (!enemies.length && player.alive) {
    state = 'win';
    timeBonus = Math.max(0, Math.round(PAR_SECONDS - levelTime / 1000)) * SECOND_BONUS;
    score += LEVEL_POINTS + timeBonus;
    hud();
    Sound.musicStop(); Sound.win();
    showEnd(true);
  }
}

function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    if (shake > 0.1) ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
 // ---- DIBUJAR MAPA Y MUROS ----
 for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * T, py = y * T;
      if (tilesImg.complete && tilesImg.naturalWidth > 0) {
        drawTile(TILE.grass[(x + y) % 2], px, py);                 // piso
      if (grid[y][x] === 1) {
  if (wallImg.complete && wallImg.naturalWidth > 0) ctx.drawImage(wallImg, 0, 0, 256, 256, px, py, T, T);
  else drawTile(TILE.tree, px, py);   // respaldo
}         // árbol (muro fijo)
        else if (grid[y][x] === 2) drawTile(TILE.rock, px, py);    // piedra (destruible)
        continue;
      }
    }
  }
  // mejoras
  for (const k in items) {
    const [x, y] = k.split(',').map(Number);
    if (POWER_FRAME[items[k]] !== undefined && powerImg.complete && powerImg.naturalWidth > 0) {
      const size = T * 0.75;
      const bob = Math.sin(clock / 250) * 2;           // sube y baja un poco
      ctx.drawImage(
        powerImg,
        POWER_FRAME[items[k]] * 256, 0, 256, 256,      // recorte del sprite
        x * T + (T - size) / 2, y * T + (T - size) / 2 + bob, size, size
      );
    } else {
      drawItemFallback(items[k], x, y);
    }
  }
  // ---- BOMBAS ----
  for (const b of bombs) {
    const px = b.x * T;
    const py = b.y * T;
    
    // Alterna entre el fotograma 0 y 1 en bucle
    const frameIndex = Math.floor(clock / 1000 * ANIM_FPS) % BOMB_FRAMES.length;
    const currentFrame = BOMB_FRAMES[frameIndex];

    if (bombSheet.complete && bombSheet.naturalWidth > 0) {
      ctx.drawImage(
        bombSheet,
        currentFrame * BS, 0, BS, BS, // Recorte del sprite 0 o 1
        px, py, T, T                  // Posición en el canvas (48x48)
      );
    } else {
      // Respaldo por si carga tarde
      const pulse = 1 + Math.sin(b.t / 90) * 0.08;
      ctx.fillStyle = '#0d1020';
      ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2 + 2, 14 * pulse, 0, 7); ctx.fill(); ctx.fillStyle = '#ffd166'; 
      ctx.fillRect(px + T / 2 - 1, py + 5, 3, 7);
    }
  }
 // ---- FUEGO / EXPLOSIÓN ----
  for (const f of fires) {
    const px = f.x * T;
    const py = f.y * T;

    // Alterna entre el fotograma 2 y 3 para dar animación al fuego
    const frameIndex = Math.floor(clock / 1000 * (ANIM_FPS * 1.5)) % FIRE_FRAMES.length;
    const currentFrame = FIRE_FRAMES[frameIndex];

    if (bombSheet.complete && bombSheet.naturalWidth > 0) {
      ctx.drawImage(
        bombSheet,
        currentFrame * BS, 0, BS, BS, // Recorte del sprite 2 o 3
        px, py, T, T                  // Posición en el canvas
      );
    } else {
      // Respaldo por si carga tarde
      ctx.fillStyle = '#ef476f'; ctx.fillRect(px + 3, py + 3, T - 6, T - 6);
    }
  }
  // enemigos
  for (const e of enemies) {
    // posición visual suave hacia su casilla
    if (e.vx === undefined) { e.vx = e.x; e.vy = e.y; e.phase = Math.floor(Math.random() * 2); }
    e.vx += (e.x - e.vx) * 0.2;
    e.vy += (e.y - e.vy) * 0.2;
    const px = e.vx * T, py = e.vy * T;

    if (enemyImg.complete && enemyImg.naturalWidth > 0) {
      const f = (Math.floor(clock / 1000 * ENEMY_FPS) + e.phase) % ENEMY_FRAMES;
      ctx.drawImage(enemyImg, f * 256, 0, 256, 256, px, py, T, T);
    } else {
      // respaldo: el fantasma morado de antes
      const cx = px + T / 2, cy = py + T / 2;
      ctx.fillStyle = '#9b5de5';
      ctx.beginPath(); ctx.arc(cx, cy, 14, Math.PI, 0); ctx.lineTo(cx + 14, cy + 14); ctx.lineTo(cx - 14, cy + 14); ctx.fill();
    }
  }
  // jugador
  {
    const px = (player.cx - 0.5) * T, py = (player.cy - 0.5) * T;
    const walking = clock - (player.lastMove || 0) < 100;
    let ok = playerImg.complete && playerImg.naturalWidth > 0;
    const blink = player.alive && player.invul > 0 && Math.floor(clock / 90) % 2 === 0;
    if (blink) { /* parpadeo: no se dibuja este fotograma */ }
    else if (ok && state === 'win') drawFrame(FRAME_WIN, px, py);
    else if (ok && !player.alive) drawFrame(FRAME_LOSE, px, py);
    else if (player.alive && !drawPlayer(px, py, walking)) {
      const cx = px + T / 2, cy = py + T / 2;   // respaldo si no carga la imagen
      ctx.fillStyle = '#eef1f8'; ctx.beginPath(); ctx.arc(cx, cy - 2, 13, 0, 7); ctx.fill();
      ctx.fillStyle = '#4361ee'; ctx.fillRect(cx - 10, cy + 6, 20, 10);
    }
  }
  drawFX();
  ctx.restore();
  if (paused) {
    ctx.fillStyle = 'rgba(10,14,28,.7)'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffd166';
    ctx.font = '28px "Press Start 2P", "Courier New", monospace';
    ctx.fillText('PAUSA', cv.width / 2, cv.height / 2);
    ctx.font = '10px "Press Start 2P", "Courier New", monospace'; ctx.fillStyle = '#9aa6c4';
    ctx.fillText('Pulsa P para continuar', cv.width / 2, cv.height / 2 + 34);
    ctx.textAlign = 'start';
  }
}

function togglePause(force) {
  if (state !== 'play') return;
  paused = force === undefined ? !paused : force;
  Sound.hold(paused);
  syncAudioBtns();
}

function press(k) {
  if (k === 'p' || k === 'P' || k === 'Escape') { togglePause(); return; }
  if (k === 'm' || k === 'M') { Sound.toggleMusic(); syncAudioBtns(); return; }
  if (k === 'n' || k === 'N') { Sound.toggleSfx(); syncAudioBtns(); return; }
  if (paused && k !== 'r' && k !== 'R') return;
  if (k === 'Enter' || k === 'r' || k === 'R') {
    if (state === 'win') { level++; const keep = { m: player.maxBombs, r: player.range, s: player.speedLv }; reset(false); player.maxBombs = keep.m; player.range = keep.r; player.speedLv = keep.s; hud(); }
    else if (state === 'lose' || k !== 'Enter') reset(true);
    return;
  }
  if (k === ' ') placeBomb();
}

addEventListener('keydown', e => {
  if (['INPUT', 'BUTTON'].includes(e.target.tagName)) return;   // no robar teclas al escribir el nombre
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  if (!keys.has(k)) press(e.key);
  keys.add(k);
  dirOn(DIRKEY[k]);
});
addEventListener('keyup', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(k);
  dirOff(DIRKEY[k]);
});
addEventListener('blur', () => { keys.clear(); dirStack.length = 0; if (state === 'play' && !paused) togglePause(true); });   // evita que se quede "pegada" una tecla

// controles táctiles
document.querySelectorAll('#pad button').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('touchstart', e => { e.preventDefault(); keys.add(k); dirOn(DIRKEY[k]); press(k); }, { passive: false });
  ['touchend', 'touchcancel'].forEach(ev => b.addEventListener(ev, () => { keys.delete(k); dirOff(DIRKEY[k]); }));
});

// ---- Guardar la partida en la tabla ----
const saveBox = document.getElementById('saveBox');
const nameInput = document.getElementById('playerName');

function showSaveBox() {
  if (score <= 0) return;                      // sin puntos no hay nada que guardar
  document.getElementById('saveSummary').textContent =
    'Llegaste al nivel ' + level + ' con ' + score + ' puntos (' + kills + ' enemigos eliminados).';
  try { if (!nameInput.value) nameInput.value = localStorage.getItem('bomberman_name') || ''; } catch (e) {}
  saveBox.hidden = false;
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) nameInput.focus();  // en celular no abre el teclado solo
}
function hideSaveBox() { saveBox.hidden = true; }

function saveEntry() {
  const name = (nameInput.value.trim() || 'Anónimo').slice(0, 12);
  const entry = {
    id: Date.now(), name, level, score, kills,
    date: new Date().toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' })
  };
  const list = loadScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score || b.level - a.level);
  saveScores(list.slice(0, MAX_SCORES));
  try { localStorage.setItem('bomberman_name', name); } catch (e) {}
  renderScores(entry.id);
  hideSaveBox();
  document.activeElement.blur();               // devuelve las teclas al juego
}

document.getElementById('saveBtn').addEventListener('click', saveEntry);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveEntry(); } });
document.getElementById('clearBtn').addEventListener('click', e => {
  if (confirm('¿Borrar toda la tabla de puntuaciones?')) { saveScores([]); renderScores(); }
  e.currentTarget.blur();
});
renderScores();

// ---- Pantalla de Game Over / Nivel superado ----
const endScreen = document.getElementById('endScreen');
let countToken = 0;

// El marcador sube desde 0 hasta la cantidad final, estilo arcade
function countUp(el, target, delay) {
  const token = ++countToken, dur = 900, t0 = performance.now() + delay;
  el.textContent = String(0).padStart(6, '0');
  (function tick(now) {
    if (token !== countToken) return;                         // otra partida empezó: se cancela
    const p = Math.min(Math.max((now - t0) / dur, 0), 1);
    el.textContent = String(Math.round(target * p)).padStart(6, '0');
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

function showEnd(won) {
  const best = (loadScores()[0] || {}).score || 0;            // mejor puntuación guardada
  endScreen.classList.toggle('win', won);
  endScreen.classList.remove('hidden');
  // reinicia las animaciones CSS para que se repitan en cada partida
  endScreen.style.animation = 'none'; void endScreen.offsetWidth; endScreen.style.animation = '';

  document.getElementById('endTitle').textContent = won ? '¡NIVEL SUPERADO!' : 'GAME OVER';
  document.getElementById('endLevel').textContent = level;
  document.getElementById('endEnemies').textContent = kills;
  document.getElementById('endRestart').textContent = won ? 'Siguiente nivel (Enter)' : 'Jugar de nuevo (R)';

  const bonus = document.getElementById('endBonus');
  bonus.hidden = !won;
  bonus.textContent = '+' + LEVEL_POINTS + ' por pasar de nivel' + (timeBonus ? '  +' + timeBonus + ' por rapidez' : '');

  document.getElementById('newRecord').hidden = won || score <= 0 || score <= best;
  countUp(document.getElementById('endScore'), score, won ? 700 : 1000);
}

function hideEnd() {
  countToken++;
  endScreen.classList.add('hidden');
  document.getElementById('newRecord').hidden = true;
}

document.getElementById('endRestart').addEventListener('click', e => {
  press(state === 'win' ? 'Enter' : 'r');
  e.currentTarget.blur();                                     // devuelve las teclas al juego
});

let last = performance.now();
function loop(now) {
  clock = now;
  const dt = Math.min(now - last, 50);
  update(dt);
  if (!paused) updateFX(dt);
  last = now;
  draw();
  requestAnimationFrame(loop);
}
// ---- Botones de pausa y sonido ----
const btnPause = document.getElementById('btnPause');
const btnMusic = document.getElementById('btnMusic');
const btnSfx = document.getElementById('btnSfx');
function syncAudioBtns() {
  btnPause.textContent = (paused ? '▶ Seguir' : '⏸ Pausa') + ' (P)';
  btnMusic.textContent = (Sound.musicOn ? '🎵' : '🔇') + ' Música (M)';
  btnSfx.textContent = (Sound.sfxOn ? '🔊' : '🔇') + ' Efectos (N)';
  btnMusic.classList.toggle('off', !Sound.musicOn);
  btnSfx.classList.toggle('off', !Sound.sfxOn);
}
btnPause.addEventListener('click', e => { togglePause(); e.currentTarget.blur(); });
btnMusic.addEventListener('click', e => { Sound.toggleMusic(); syncAudioBtns(); e.currentTarget.blur(); });
btnSfx.addEventListener('click', e => { Sound.toggleSfx(); syncAudioBtns(); e.currentTarget.blur(); });
syncAudioBtns();

reset(true);
requestAnimationFrame(loop);

