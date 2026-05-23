// grid.js – отрисовка, геометрия, хранение сетки, поиск пути

const canvas = document.getElementById('hexCanvas');
const ctx = canvas.getContext('2d');

// -------------------- Конфигурация --------------------
const CONFIG = {
  MENU_LEFT_MARGIN: 330,

  HEX: {
    SIZE: 32,
    POINTY_TOP: {
      // hexToPixelRaw: px = size * (1.5 * q), py = size * (sqrt(3) * r + sqrt(3)/2 * q)
      X_FACTOR: 1.5,
      Y_R_FACTOR: Math.sqrt(3),
      Y_Q_FACTOR: Math.sqrt(3) / 2
    }
  },

  CELL: {
    LINE_WIDTH: 1.5,
    IMAGE_SCALE: 1.2,
    TEXT_SCALE: 0.52
  },

  COLORS: {
    ACTIVE_EMPTY_FILL: 'rgba(80, 220, 100, 0.25)',
    ACTIVE_ASPECT_WAIT_FILL: 'rgba(220, 180, 80, 0.45)',
    ACTIVE_ASPECT_DONE_FILL: 'rgba(80, 220, 100, 0.45)',
    INACTIVE_FILL: 'rgba(210, 230, 255, 0.05)',

    ACTIVE_EMPTY_STROKE: '#aaffaa',
    ACTIVE_ASPECT_WAIT_STROKE: '#ffcc55',
    ACTIVE_ASPECT_DONE_STROKE: '#88ff88',
    INACTIVE_STROKE: '#5a6e7c',

    ASPECT_TEXT: '#ffffcc',
    CONNECTION_STROKE: '#ffda77'
  },

  CONNECTION: {
    LINE_WIDTH: 2,
    DASH: [4, 4]
  }
};

// -------------------- Глобальное состояние --------------------
// Глобальное состояние сетки: Map("x,y" -> { active: bool, aspect: string|null, generated: bool })
let gridState = new Map();
let currentRadius = 4;

let HEX_SIZE = CONFIG.HEX.SIZE;
let OFFSET_X = 0;
let OFFSET_Y = 0;

// Кэш экранных координат (пересчитывается при updateOffsets/resize/HEX_SIZE)
let pixelCache = new Map(); // Map(key -> { px, py })

// Кэш изображений аспектов (заполняется из app.js)
const aspectImages = window.aspectImages instanceof Map ? window.aspectImages : new Map();
window.aspectImages = aspectImages;

// -------------------- Helpers: ключи, состояния, соседи --------------------
function makeKey(x, y) {
  return `${x},${y}`;
}

function parseKey(key) {
  // Важно: сохраняем формат "x,y" как есть, просто убираем дублирование split/map(Number)
  const comma = key.indexOf(',');
  return {
    x: Number(key.slice(0, comma)),
    y: Number(key.slice(comma + 1))
  };
}

// Направления соседей для осевых координат (pointy-top)
const DIRECTIONS = Object.freeze([
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
]);

// Оставляем функцию для совместимости; аргументы не нужны, но не ломаем внешний вызов
function getNeighbors() {
  return DIRECTIONS;
}

function neighborKey(x, y, dx, dy) {
  return makeKey(x + dx, y + dy);
}

// Булевые помощники для аспектов
function hasAspect(cell) {
  return !!cell.aspect;
}
function isGenerated(cell) {
  return !!cell.generated;
}
function isWaitingGeneration(cell) {
  return hasAspect(cell) && !isGenerated(cell);
}

// Централизованные стили клетки
function getCellVisual(cell) {
  const active = !!cell.active;
  const aspect = hasAspect(cell);
  const waiting = isWaitingGeneration(cell);
  const done = aspect && isGenerated(cell);

  let fillStyle;
  if (active) {
    if (waiting) fillStyle = CONFIG.COLORS.ACTIVE_ASPECT_WAIT_FILL;
    else if (done) fillStyle = CONFIG.COLORS.ACTIVE_ASPECT_DONE_FILL;
    else fillStyle = CONFIG.COLORS.ACTIVE_EMPTY_FILL;
  } else {
    fillStyle = CONFIG.COLORS.INACTIVE_FILL;
  }

  let strokeStyle;
  if (waiting) strokeStyle = CONFIG.COLORS.ACTIVE_ASPECT_WAIT_STROKE;
  else if (done) strokeStyle = CONFIG.COLORS.ACTIVE_ASPECT_DONE_STROKE;
  else strokeStyle = active ? CONFIG.COLORS.ACTIVE_EMPTY_STROKE : CONFIG.COLORS.INACTIVE_STROKE;

  return {
    fillStyle,
    strokeStyle,
    lineWidth: CONFIG.CELL.LINE_WIDTH
  };
}

// -------------------- Координатная математика (осевая система с pointy-top) --------------------
function hexToPixelRaw(x, y) {
  const P = CONFIG.HEX.POINTY_TOP;
  return {
    px: HEX_SIZE * (P.X_FACTOR * x),
    py: HEX_SIZE * (P.Y_R_FACTOR * y + P.Y_Q_FACTOR * x)
  };
}

function hexToPixel(x, y, keyHint) {
  // Лёгкий кэш для ускорения отрисовки/линий
  const key = keyHint || makeKey(x, y);
  const cached = pixelCache.get(key);
  if (cached) return cached;

  const { px, py } = hexToPixelRaw(x, y);
  const res = { px: px + OFFSET_X, py: py + OFFSET_Y };
  pixelCache.set(key, res);
  return res;
}

function clearPixelCache() {
  pixelCache.clear();
}

function pixelToHex(px, py) {
  const adjX = px - OFFSET_X;
  const adjY = py - OFFSET_Y;
  const q = (2 / 3 * adjX) / HEX_SIZE;
  const r = (-1 / 3 * adjX + Math.sqrt(3) / 3 * adjY) / HEX_SIZE;
  return cubeRound(q, r, -q - r);
}

function cubeRound(q, r, s) {
  let rq = Math.round(q),
    rr = Math.round(r),
    rs = Math.round(s);

  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;

  return { x: rq, y: rr };
}

// -------------------- Сетка --------------------
function generateGrid(radius) {
  gridState.clear();
  for (let x = -radius; x <= radius; x++) {
    const yMin = Math.max(-radius, -radius - x);
    const yMax = Math.min(radius, radius - x);
    for (let y = yMin; y <= yMax; y++) {
      gridState.set(makeKey(x, y), { active: true, aspect: null, generated: false });
    }
  }
  currentRadius = radius;
  updateOffsets();
}

// -------------------- Центрирование --------------------
function getHexBounds() {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const [key] of gridState) {
    const { x, y } = parseKey(key);
    const { px, py } = hexToPixelRaw(x, y);
    minX = Math.min(minX, px - HEX_SIZE);
    maxX = Math.max(maxX, px + HEX_SIZE);
    minY = Math.min(minY, py - HEX_SIZE);
    maxY = Math.max(maxY, py + HEX_SIZE);
  }
  return { minX, maxX, minY, maxY };
}

function updateOffsets() {
  if (gridState.size === 0) return;

  const { minX, maxX, minY, maxY } = getHexBounds();

  // Меню имеет ширину 310px + отступы, оставляем 330px слева
  OFFSET_X = CONFIG.MENU_LEFT_MARGIN - minX;

  // Центрируем по вертикали
  OFFSET_Y = canvas.height / 2 - (minY + maxY) / 2;

  // Сдвиг изменился — экранные координаты нужно пересчитать
  clearPixelCache();
}

// -------------------- Отрисовка --------------------
function drawHexagon(cx, cy, cell) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + HEX_SIZE * Math.cos(angle);
    const y = cy + HEX_SIZE * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const visual = getCellVisual(cell);
  ctx.fillStyle = visual.fillStyle;
  ctx.fill();

  ctx.strokeStyle = visual.strokeStyle;
  ctx.lineWidth = visual.lineWidth;
  ctx.stroke();

  if (cell.aspect) {
    const img = aspectImages.get(cell.aspect);
    if (img) {
      const imgSize = HEX_SIZE * CONFIG.CELL.IMAGE_SCALE;
      ctx.drawImage(img, cx - imgSize / 2, cy - imgSize / 2, imgSize, imgSize);
    } else {
      ctx.fillStyle = CONFIG.COLORS.ASPECT_TEXT;
      ctx.font = `bold ${HEX_SIZE * CONFIG.CELL.TEXT_SCALE}px "Segoe UI", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cell.aspect.substring(0, 5), cx, cy);
    }
  }
}

function drawConnectionLine(p1, p2) {
  ctx.beginPath();
  ctx.moveTo(p1.px, p1.py);
  ctx.lineTo(p2.px, p2.py);
  ctx.strokeStyle = CONFIG.COLORS.CONNECTION_STROKE;
  ctx.lineWidth = CONFIG.CONNECTION.LINE_WIDTH;
  ctx.setLineDash(CONFIG.CONNECTION.DASH);
  ctx.stroke();
  ctx.setLineDash([]);
}

function getRecipe(aspect) {
  return window.ASPECT_RECIPES?.[aspect] || null;
}

function isValidRecipe(recipe) {
  return Array.isArray(recipe) && recipe.length === 2;
}

function shouldConnect(cellAspect, neighborAspect) {
  const recipe = getRecipe(cellAspect);
  if (!isValidRecipe(recipe)) return false;
  return recipe.includes(neighborAspect);
}

function drawConnectionsForCell(key, cell, drawnEdges) {
  if (!hasAspect(cell)) return;

  const recipe = getRecipe(cell.aspect);
  if (!isValidRecipe(recipe)) return;

  const { x, y } = parseKey(key);

  for (const [dx, dy] of DIRECTIONS) {
    const nKey = neighborKey(x, y, dx, dy);
    if (!gridState.has(nKey)) continue;

    const neighbor = gridState.get(nKey);
    if (!neighbor || !hasAspect(neighbor)) continue;
    if (!recipe.includes(neighbor.aspect)) continue;

    const edgeId = [key, nKey].sort().join('|');
    if (drawnEdges.has(edgeId)) continue;
    drawnEdges.add(edgeId);

    const p1 = hexToPixel(x, y, key);
    const { x: nx, y: ny } = parseKey(nKey);
    const p2 = hexToPixel(nx, ny, nKey);
    drawConnectionLine(p1, p2);
  }
}

function drawConnections() {
  const drawnEdges = new Set();
  for (const [key, cell] of gridState) {
    drawConnectionsForCell(key, cell, drawnEdges);
  }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let activeCount = 0;
  for (const [key, cell] of gridState) {
    const { x, y } = parseKey(key);
    const { px, py } = hexToPixel(x, y, key);
    drawHexagon(px, py, cell);
    if (cell.active) activeCount++;
  }

  document.getElementById('activeCount').textContent = activeCount;
  drawConnections();
}

// -------------------- Поиск кратчайшего пути по активным клеткам --------------------
function findShortestPath(startKey, endKey) {
  if (startKey === endKey) return [startKey];

  // BFS без queue.shift() — используем индекс головы
  const queue = [{ key: startKey, path: [startKey] }];
  let head = 0;

  const visited = new Set([startKey]);

  while (head < queue.length) {
    const { key, path } = queue[head++];
    const { x, y } = parseKey(key);

    for (const [dx, dy] of DIRECTIONS) {
      const nKey = neighborKey(x, y, dx, dy);
      if (!gridState.has(nKey)) continue;

      const cell = gridState.get(nKey);
      if (!cell) continue;

      if (!cell.active && nKey !== endKey) continue;
      if (visited.has(nKey)) continue;

      const newPath = [...path, nKey];
      if (nKey === endKey) return newPath;

      visited.add(nKey);
      queue.push({ key: nKey, path: newPath });
    }
  }

  return null;
}

// -------------------- Подгонка размера canvas --------------------
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  updateOffsets(); // внутри сбросит pixelCache
  redraw();
}

window.addEventListener('resize', () => {
  resizeCanvas();
  if (window.scheduleTableRefresh) {
    // Небольшая задержка для завершения отрисовки
    setTimeout(() => window.scheduleTableRefresh(), 100);
  }
});

// -------------------- Экспорт API --------------------
// Новый единый объект (с сохранением обратной совместимости со старыми window.*)
const gridAPI = {
  gridState,
  generateGrid,
  redraw,
  resizeCanvas,
  findShortestPath,
  pixelToHex,
  getNeighbors,
  makeKey,
  parseKey,

  // Для совместимости/инспекта
  get HEX_SIZE() {
    return HEX_SIZE;
  }
};

window.gridAPI = gridAPI;

// Backward compatibility (не ломаем существующий app.js)
window.gridState = gridState;
window.generateGrid = generateGrid;
window.redraw = redraw;
window.resizeCanvas = resizeCanvas;
window.findShortestPath = findShortestPath;
window.pixelToHex = pixelToHex;
window.getNeighbors = getNeighbors;
window.HEX_SIZE = HEX_SIZE;
