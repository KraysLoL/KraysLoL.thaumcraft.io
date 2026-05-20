// app.js – полная исправленная версия с кастомным select и подсветкой аспектов

// ---------- Рецепты аспектов ----------
const FULL_ASPECT_RECIPES = {
  "aer": [], "terra": [], "ignis": [], "aqua": [], "ordo": [], "perditio": [],
  "vacuos": ["aer","perditio"], "lux": ["aer","ignis"], "potentia": ["ordo","ignis"],
  "motus": ["aer","ordo"], "gelum": ["ignis","perditio"], "vitreus": ["terra","ordo"],
  "victus": ["aqua","terra"], "venenum": ["aqua","perditio"], "permutatio": ["perditio","ordo"],
  "metallum": ["terra","vitreus"], "mortuus": ["victus","perditio"], "volatus": ["aer","motus"],
  "tenebrae": ["vacuos","lux"], "spiritus": ["victus","mortuus"], "sano": ["ordo","victus"],
  "iter": ["motus","terra"], "alienis": ["vacuos","tenebrae"], "praecantatio": ["vacuos","potentia"],
  "auram": ["praecantatio","aer"], "vitium": ["praecantatio","perditio"], "limus": ["victus","aqua"],
  "herba": ["victus","terra"], "arbor": ["aer","herba"], "bestia": ["motus","victus"],
  "corpus": ["mortuus","bestia"], "exanimis": ["motus","mortuus"], "cognitio": ["ignis","spiritus"],
  "sensus": ["aer","spiritus"], "humanus": ["bestia","cognitio"], "messis": ["herba","humanus"],
  "perfodio": ["humanus","terra"], "instrumentum": ["humanus","ordo"], "meto": ["messis","instrumentum"],
  "telum": ["instrumentum","ignis"], "tutamen": ["instrumentum","terra"], "fames": ["victus","vacuos"],
  "lucrum": ["humanus","fames"], "fabrico": ["humanus","instrumentum"], "pannus": ["instrumentum","bestia"],
  "machina": ["motus","instrumentum"], "vinculum": ["motus","perditio"], "tempestas": ["aer","aqua"],
  "granum": ["victus","ordo"], "saxum": ["terra","terra"], "caelum": ["vitreus","metallum"],
  "tempus": ["vacuos","ordo"], "gula": ["fames","vacuos"], "infernus": ["ignis","praecantatio"],
  "ira": ["telum","ignis"], "luxuria": ["corpus","fames"], "superbia": ["volatus","vacuos"],
  "desidia": ["vinculum","spiritus"], "invidia": ["sensus","fames"]
};

const chainCache = new Map();
const connectionCache = new Map();

const ASPECT_RECIPES = { ...FULL_ASPECT_RECIPES };
window.ASPECT_RECIPES = ASPECT_RECIPES;

const ALL_ASPECTS = Object.keys(ASPECT_RECIPES).sort();

function buildAspectGraph() {
  const graph = {};
  for (const [asp, deps] of Object.entries(ASPECT_RECIPES)) {
    if (!graph[asp]) graph[asp] = new Set();
    for (const dep of deps) {
      if (!graph[dep]) graph[dep] = new Set();
      graph[asp].add(dep);
      graph[dep].add(asp);
    }
  }
  const result = {};
  for (const [k, v] of Object.entries(graph)) {
    result[k] = [...v];
  }
  return result;
}

function findAspectChainOfLength(startAsp, endAsp, exactLength, graph) {
  if (exactLength === 0 && startAsp === endAsp) return [startAsp];
  const cacheKey = `${startAsp}|${endAsp}|${exactLength}`;
  if (chainCache.has(cacheKey)) return chainCache.get(cacheKey);
  
  const queue = [{ node: startAsp, path: [startAsp], depth: 0 }];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.depth === exactLength && cur.node === endAsp) {
      chainCache.set(cacheKey, cur.path);
      return cur.path;
    }
    if (cur.depth >= exactLength) continue;
    for (const nb of graph[cur.node] || []) {
      if (cur.path.includes(nb)) continue;
      queue.push({
        node: nb,
        depth: cur.depth + 1,
        path: [...cur.path, nb]
      });
    }
  }
  chainCache.set(cacheKey, null);
  return null;
}

function findPathOfExactLength(startKey, endKey, exactEdges) {
  if (exactEdges === 0 && startKey === endKey) return [startKey];
  
  const cacheKey = `${startKey}|${endKey}|${exactEdges}`;
  if (connectionCache.has(cacheKey)) return connectionCache.get(cacheKey);
  
  const queue = [{ 
    key: startKey, 
    path: [startKey], 
    visitedSet: new Set([startKey])
  }];
  let head = 0;
  
  while (head < queue.length) {
    const { key, path, visitedSet } = queue[head++];
    const depth = path.length - 1;
    
    if (depth === exactEdges && key === endKey) {
      connectionCache.set(cacheKey, path);
      return path;
    }
    if (depth >= exactEdges) continue;
    
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of getNeighbors(x, y)) {
      const nKey = `${x + dx},${y + dy}`;
      if (!gridState.has(nKey)) continue;
      const cell = gridState.get(nKey);
      if (!cell.active && nKey !== endKey) continue;
      if (visitedSet.has(nKey)) continue;
      
      const newVisited = new Set(visitedSet);
      newVisited.add(nKey);
      queue.push({
        key: nKey,
        path: [...path, nKey],
        visitedSet: newVisited
      });
    }
  }
  
  connectionCache.set(cacheKey, null);
  return null;
}

function clearPathCache() {
  connectionCache.clear();
}

function clearGeneratedAspects() {
  let cleared = 0;
  for (const cell of gridState.values()) {
    if (cell.generated) {
      cell.aspect = null;
      cell.generated = false;
      cleared++;
    }
  }
  if (cleared > 0) {
    redraw();
    log(`🧹 Удалено ${cleared} автоматически созданных аспектов.`, 'info');
  }
}

function connectAllAspects() {
  chainCache.clear();
  clearPathCache();
  clearGeneratedAspects();
  
  const placed = [];
  for (const [key, cell] of gridState) {
    if (cell.aspect && !cell.generated) {
      placed.push({ key, aspect: cell.aspect });
    }
  }
  
  if (placed.length < 2) {
    log("Нужно минимум 2 пользовательских аспекта", "error");
    return;
  }
  
  const aspectGraph = buildAspectGraph();
  const network = new Set();
  const remaining = [...placed];
  
  network.add(remaining[0].key);
  remaining.shift();
  
  let totalAdded = 0;
  const MAX_LENGTH_OFFSET = 5;
  
  while (remaining.length) {
    let best = null;
    let bestMinDist = Infinity;
    
    for (const netKey of network) {
      const netCell = gridState.get(netKey);
      for (const target of remaining) {
        const shortestPath = findShortestPath(netKey, target.key);
        if (!shortestPath) continue;
        const dist = shortestPath.length - 1;
        if (dist < bestMinDist) {
          bestMinDist = dist;
          best = {
            fromKey: netKey,
            toKey: target.key,
            fromAsp: netCell.aspect,
            toAsp: target.aspect,
            minDist: dist,
            shortestPath: shortestPath
          };
        }
      }
    }
    
    if (!best) {
      log("Нет доступных путей для соединения", "error");
      break;
    }
    
    let finalPath = null;
    let finalChain = null;
    let usedLength = -1;
    
    for (let offset = 0; offset <= MAX_LENGTH_OFFSET; offset++) {
      const targetLen = best.minDist + offset;
      const chain = findAspectChainOfLength(best.fromAsp, best.toAsp, targetLen, aspectGraph);
      if (!chain) continue;
      const path = findPathOfExactLength(best.fromKey, best.toKey, targetLen);
      if (!path) continue;
      finalPath = path;
      finalChain = chain;
      usedLength = targetLen;
      break;
    }
    
    if (!finalPath || !finalChain) {
      log(`Не удалось соединить ${best.fromAsp} → ${best.toAsp} даже с удлинением`, "error");
      network.add(best.toKey);
      remaining.splice(remaining.findIndex(x => x.key === best.toKey), 1);
      continue;
    }
    
    const cells = finalPath.slice(1, -1);
    const aspects = finalChain.slice(1, -1);
    
    if (cells.length !== aspects.length) {
      log(`Ошибка: несовпадение длины (клеток=${cells.length}, аспектов=${aspects.length})`, "error");
      network.add(best.toKey);
      remaining.splice(remaining.findIndex(x => x.key === best.toKey), 1);
      continue;
    }
    
    for (let i = 0; i < cells.length; i++) {
      const cell = gridState.get(cells[i]);
      if (!cell.aspect) {
        cell.aspect = aspects[i];
        cell.generated = true;
        totalAdded++;
      } else if (!cell.generated && cell.aspect !== aspects[i]) {
        log(`Конфликт: на ${cells[i]} уже есть пользовательский аспект ${cell.aspect}, пропускаем`, "warn");
        continue;
      } else if (cell.generated && cell.aspect !== aspects[i]) {
        cell.aspect = aspects[i];
      }
    }
    
    network.add(best.toKey);
    for(const key of finalPath){
      network.add(key);
    }
    
    const targetIndex = remaining.findIndex(x => x.key === best.toKey);
    if (targetIndex !== -1) {
      remaining.splice(targetIndex, 1);
    }
    
    log(`🔗 ${best.fromAsp} → ${best.toAsp} (длина пути ${usedLength} рёбер)`, "info");
  }
  
  redraw();
  log(`✅ Готово. Добавлено новых аспектов: ${totalAdded}`, "success");
}

function clearAllAspects() {
  for (const cell of gridState.values()) {
    cell.aspect = null;
    cell.generated = false;
  }
  redraw();
  log('🧹 Все аспекты (и ручные, и автоматические) удалены.', 'info');
}

function exportState() {
  const activeCells = [];
  const aspectCells = [];
  for (const [key, cell] of gridState) {
    if (cell.active) activeCells.push(key);
    if (cell.aspect && !cell.generated) aspectCells.push(`${key}:${cell.aspect}`);
  }
  const data = {
    version: "full_aspects_4.3",
    radius: currentRadius,
    activeCells,
    aspectCells
  };
  const exportText = document.getElementById('exportText');
  exportText.value = JSON.stringify(data, null, 2);
  document.getElementById('exportArea').style.display = 'block';
  log('📦 Состояние экспортировано (только пользовательские аспекты).', 'info');
}

function importState() {
  const importText = document.getElementById('importText').value.trim();
  if (!importText) {
    log('⚠️ Вставьте JSON состояние в поле импорта.', 'error');
    return;
  }
  let data;
  try {
    data = JSON.parse(importText);
  } catch {
    log('❌ Ошибка парсинга JSON.', 'error');
    return;
  }
  if (!data.version || !data.version.startsWith('full_aspects')) {
    log('❌ Неподдерживаемая версия данных.', 'error');
    return;
  }
  const radius = data.radius || 4;
  if (radius < 2 || radius > 9) {
    log('❌ Радиус должен быть от 2 до 9.', 'error');
    return;
  }
  generateGrid(radius);
  document.getElementById('radiusInput').value = radius;
  
  for (const cell of gridState.values()) {
    cell.aspect = null;
    cell.generated = false;
    cell.active = false;
  }
  
  if (Array.isArray(data.activeCells)) {
    for (const key of data.activeCells) {
      if (gridState.has(key)) {
        gridState.get(key).active = true;
      } else {
        log(`⚠️ Клетка ${key} отсутствует, пропущена.`, 'warn');
      }
    }
  }
  if (Array.isArray(data.aspectCells)) {
    for (const item of data.aspectCells) {
      const [key, aspect] = item.split(':');
      if (gridState.has(key) && ALL_ASPECTS.includes(aspect)) {
        const cell = gridState.get(key);
        cell.active = true;
        cell.aspect = aspect;
        cell.generated = false;
      } else {
        log(`⚠️ Не удалось разместить ${item}.`, 'warn');
      }
    }
  }
  redraw();
  log(`📥 Состояние загружено (радиус ${radius})`, 'success');
}

function log(msg, type = 'info') {
  const logDiv = document.getElementById('log');
  const div = document.createElement('div');
  div.textContent = msg;
  div.style.marginBottom = '4px';
  div.style.paddingLeft = '6px';
  if (type === 'error') {
    div.style.borderLeft = '2px solid #ff7777';
    div.style.color = '#ffb7b7';
  } else if (type === 'success') {
    div.style.borderLeft = '2px solid #77ff77';
    div.style.color = '#c6ffb3';
  } else {
    div.style.borderLeft = '2px solid #88aaff';
    div.style.color = '#ddd';
  }
  logDiv.appendChild(div);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function loadAspectImages() {
  let loadedCount = 0;
  ALL_ASPECTS.forEach(aspect => {
    const img = new Image();
    img.src = `color/${aspect}.png`;
    img.onload = () => {
      aspectImages.set(aspect, img);
      loadedCount++;
      redraw();
      if (loadedCount === ALL_ASPECTS.length) {
        log(`🖼️ Загружены все иконки аспектов (${loadedCount})`, 'success');
        // После загрузки всех иконок инициализируем кастомный select
        initCustomSelect();
      }
    };
    img.onerror = () => {
      // Если иконка не найдена, используем текстовый fallback
      aspectImages.set(aspect, null);
      loadedCount++;
      if (loadedCount === ALL_ASPECTS.length) {
        log(`🖼️ Загружено ${loadedCount} аспектов (некоторые без иконок)`, 'info');
        initCustomSelect();
      }
    };
  });
}

// ========== КАСТОМНЫЙ SELECT С ИКОНКАМИ ==========
let currentAspect = 'aer';

function initCustomSelect() {
  const selectDropdown = document.getElementById('selectDropdown');
  const selectedText = document.getElementById('selectedText');
  const selectedIcon = document.getElementById('selectedIcon');
  
  if (!selectDropdown) return;
  
  selectDropdown.innerHTML = '';
  
  ALL_ASPECTS.forEach(aspect => {
    const option = document.createElement('div');
    option.className = 'select-option';
    if (aspect === currentAspect) option.classList.add('selected');
    
    const img = document.createElement('img');
    const iconImg = aspectImages.get(aspect);
    if (iconImg) {
      img.src = iconImg.src;
      img.style.width = '24px';
      img.style.height = '24px';
    } else {
      img.style.display = 'none';
    }
    img.alt = aspect;
    
    const text = document.createElement('span');
    text.textContent = aspect;
    
    option.appendChild(img);
    option.appendChild(text);
    
    option.addEventListener('click', () => {
      currentAspect = aspect;
      selectedText.textContent = aspect;
      const selectedIconImg = aspectImages.get(aspect);
      if (selectedIconImg) {
        selectedIcon.src = selectedIconImg.src;
        selectedIcon.style.display = 'inline';
      } else {
        selectedIcon.style.display = 'none';
      }
      
      document.querySelectorAll('.select-option').forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      
      selectDropdown.classList.remove('show');
    });
    
    selectDropdown.appendChild(option);
  });
  
  selectedText.textContent = currentAspect;
  const firstIcon = aspectImages.get(currentAspect);
  if (firstIcon) {
    selectedIcon.src = firstIcon.src;
    selectedIcon.style.display = 'inline';
  }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  const radiusInput = document.getElementById('radiusInput');
  radiusInput.value = currentRadius;
  
  generateGrid(currentRadius);
  resizeCanvas();
  redraw();
  loadAspectImages();
  
  // ========== ЛОГИКА ЗАЖАТОЙ ЛКМ ==========
  let isMouseDown = false;
  let currentMode = null;
  
  function updateCellState(key) {
    if (!gridState.has(key)) return;
    const cell = gridState.get(key);
    
    if (currentMode === 'activate' && !cell.active) {
      cell.active = true;
      redraw();
    } else if (currentMode === 'deactivate' && cell.active) {
      cell.active = false;
      cell.aspect = null;
      cell.generated = false;
      redraw();
    }
  }
  
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      isMouseDown = true;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;
      const hex = pixelToHex(mouseX, mouseY);
      const key = `${hex.x},${hex.y}`;
      
      if (gridState.has(key)) {
        const cell = gridState.get(key);
        currentMode = cell.active ? 'deactivate' : 'activate';
        updateCellState(key);
      }
      e.preventDefault();
    }
  });
  
  canvas.addEventListener('mouseup', () => {
    isMouseDown = false;
    currentMode = null;
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (!isMouseDown || currentMode === null) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    const hex = pixelToHex(mouseX, mouseY);
    const key = `${hex.x},${hex.y}`;
    
    updateCellState(key);
  });
  
  // ========== ТУЛТИП ==========
  const tooltip = document.getElementById('aspect-tooltip');
  
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    const hex = pixelToHex(mouseX, mouseY);
    const key = `${hex.x},${hex.y}`;
    const cell = gridState.get(key);
    
    if (cell && cell.aspect) {
      tooltip.textContent = cell.aspect;
      tooltip.style.opacity = '1';
      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY - 30) + 'px';
    } else {
      tooltip.style.opacity = '0';
    }
  });
  
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });
  
  // ========== ПКМ (установка аспекта) ==========
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    const hex = pixelToHex(mouseX, mouseY);
    const key = `${hex.x},${hex.y}`;
    const cell = gridState.get(key);
    if (cell && cell.active) {
      cell.aspect = currentAspect;
      cell.generated = false;
      redraw();
      log(`📌 Установлен "${cell.aspect}" на (${hex.x},${hex.y})`, 'info');
    } else if (cell && !cell.active) {
      log(`❌ Сначала активируйте клетку (зажмите ЛКМ и проведите).`, 'error');
    }
    return false;
  });
  
  // ========== КНОПКИ ==========
  document.getElementById('calculateBtn').addEventListener('click', connectAllAspects);
  document.getElementById('clearBtn').addEventListener('click', clearAllAspects);
  document.getElementById('exportBtn').addEventListener('click', exportState);
  document.getElementById('copyBtn').addEventListener('click', () => {
    const exportText = document.getElementById('exportText');
    exportText.select();
    document.execCommand('copy');
    log('📋 JSON скопирован.', 'success');
  });
  document.getElementById('importBtn').addEventListener('click', importState);
  
  radiusInput.addEventListener('change', () => {
    let newRadius = parseInt(radiusInput.value, 10);
    if (isNaN(newRadius) || newRadius < 2) newRadius = 2;
    if (newRadius > 9) newRadius = 9;
    generateGrid(newRadius);
    clearPathCache();
    redraw();
    log(`🌐 Радиус изменён на ${newRadius}.`, 'info');
  });
  
  // Обработчики кастомного select
  const selectTrigger = document.getElementById('selectTrigger');
  const selectDropdown = document.getElementById('selectDropdown');
  
  if (selectTrigger) {
    selectTrigger.addEventListener('click', () => {
      selectDropdown.classList.toggle('show');
    });
  }
  
  document.addEventListener('click', (e) => {
    if (selectTrigger && !selectTrigger.contains(e.target) && selectDropdown && !selectDropdown.contains(e.target)) {
      selectDropdown.classList.remove('show');
    }
  });
  
  log(`📚 Загружено аспектов: ${ALL_ASPECTS.length} (все аддоны).`, 'success');
  log(`💡 Зажмите ЛКМ и водите по клеткам, чтобы включать/выключать их. ПКМ для установки аспекта.`, 'info');
});
