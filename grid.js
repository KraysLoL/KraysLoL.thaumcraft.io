// grid.js – отрисовка, геометрия, хранение сетки, поиск пути

const canvas = document.getElementById('hexCanvas');
const ctx = canvas.getContext('2d');

// Глобальное состояние сетки: Map("x,y" -> { active: bool, aspect: string|null })
let gridState = new Map();
let currentRadius = 4;
let HEX_SIZE = 32;
let OFFSET_X = 0, OFFSET_Y = 0;

// Кэш изображений аспектов (заполняется из app.js)
const aspectImages = new Map();
window.aspectImages = aspectImages;   // экспорт для доступа из app.js

// ---------- Координатная математика (осевая система с pointy-top) ----------
function hexToPixelRaw(x, y) {
  return {
    px: HEX_SIZE * (1.5 * x),
    py: HEX_SIZE * (Math.sqrt(3) * y + (Math.sqrt(3) / 2) * x)
  };
}

function hexToPixel(x, y) {
  const { px, py } = hexToPixelRaw(x, y);
  return { px: px + OFFSET_X, py: py + OFFSET_Y };
}

function pixelToHex(px, py) {
  const adjX = px - OFFSET_X;
  const adjY = py - OFFSET_Y;
  const q = (2 / 3 * adjX) / HEX_SIZE;
  const r = (-1 / 3 * adjX + Math.sqrt(3) / 3 * adjY) / HEX_SIZE;
  return cubeRound(q, r, -q - r);
}

function cubeRound(q, r, s) {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { x: rq, y: rr };
}

// Соседи для осевых координат (pointy-top)
function getNeighbors(x, y) {
  return [
    [1, 0], [1, -1], [0, -1],
    [-1, 0], [-1, 1], [0, 1]
  ];
}

// ---------- Сетка ----------
function generateGrid(radius) {
  gridState.clear();
  for (let x = -radius; x <= radius; x++) {
    const yMin = Math.max(-radius, -radius - x);
    const yMax = Math.min(radius, radius - x);
    for (let y = yMin; y <= yMax; y++) {
      gridState.set(`${x},${y}`, { active: true, aspect: null });  // ← true вместо false
    }
  }
  currentRadius = radius;
  updateOffsets();
}

// ---------- Центрирование ----------
function getHexBounds() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let [key] of gridState) {
    const [x, y] = key.split(',').map(Number);
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
  OFFSET_X = canvas.width / 2 - (minX + maxX) / 2;
  OFFSET_Y = canvas.height / 2 - (minY + maxY) / 2;
}

// ---------- Отрисовка ----------
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
  ctx.fillStyle = cell.active ? 'rgba(80, 220, 100, 0.45)' : 'rgba(210, 230, 255, 0.05)';
  ctx.fill();
  ctx.strokeStyle = cell.active ? '#aaffaa' : '#5a6e7c';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (cell.aspect) {
    const img = aspectImages.get(cell.aspect);
    if (img) {
      // Рисуем картинку вместо текста
      const imgSize = HEX_SIZE * 1.2;  // чуть больше гекса для красоты
      ctx.drawImage(img, cx - imgSize/2, cy - imgSize/2, imgSize, imgSize);
    } else {
      // Fallback – текст
      ctx.fillStyle = '#ffffcc';
      ctx.font = `bold ${HEX_SIZE * 0.52}px "Segoe UI", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cell.aspect.substring(0, 5), cx, cy);
    }
  }
}

function drawConnections() {

    const drawn=new Set();

    for(
        const [key,cell]
        of gridState
    ){

        if(!cell.aspect)
            continue;

        const recipe=
        window
        .ASPECT_RECIPES
        ?.[cell.aspect];

        if(
            !recipe ||
            recipe.length!==2
        )
            continue;

        const [x,y]=
        key.split(',')
        .map(Number);

        for(
            const [dx,dy]
            of getNeighbors(x,y)
        ){

            const nKey=
            `${x+dx},${y+dy}`;

            if(
                !gridState.has(
                    nKey
                )
            )
                continue;

            const neighbor=
            gridState.get(
                nKey
            );

            if(
                !neighbor.aspect
            )
                continue;

            if(
                !recipe.includes(
                    neighbor.aspect
                )
            )
                continue;

            const edge=
            [key,nKey]
            .sort()
            .join('|');

            if(
                drawn.has(edge)
            )
                continue;

            drawn.add(edge);

            const p1=
            hexToPixel(x,y);

            const [nx,ny]=
            nKey.split(',')
            .map(Number);

            const p2=
            hexToPixel(nx,ny);

            ctx.beginPath();

            ctx.moveTo(
                p1.px,
                p1.py
            );

            ctx.lineTo(
                p2.px,
                p2.py
            );

            ctx.strokeStyle=
            '#ffda77';

            ctx.lineWidth=2;

            ctx.setLineDash(
                [4,4]
            );

            ctx.stroke();

            ctx.setLineDash([]);
        }
    }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let activeCount = 0;
  for (let [key, cell] of gridState) {
    const [x, y] = key.split(',').map(Number);
    const { px, py } = hexToPixel(x, y);
    drawHexagon(px, py, cell);
    if (cell.active) activeCount++;
  }
  document.getElementById('activeCount').textContent = activeCount;
  drawConnections();
}

// Поиск кратчайшего пути по активным клеткам
function findShortestPath(startKey, endKey) {
  if (startKey === endKey) return [startKey];
  const queue = [{ key: startKey, path: [startKey] }];
  const visited = new Set([startKey]);
  while (queue.length) {
    const { key, path } = queue.shift();
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of getNeighbors(x, y)) {
      const nKey = `${x + dx},${y + dy}`;
      if (!gridState.has(nKey)) continue;
      const cell = gridState.get(nKey);
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

// Подгонка размера canvas
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  updateOffsets();
  redraw();
}
window.addEventListener('resize', resizeCanvas);

// Экспорт функций для использования в app.js
window.gridState = gridState;
window.generateGrid = generateGrid;
window.redraw = redraw;
window.resizeCanvas = resizeCanvas;
window.findShortestPath = findShortestPath;
window.pixelToHex = pixelToHex;
