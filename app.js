// app.js – полная исправленная версия с кастомным select и подсветкой аспектов

// ---------- Рецепты аспектов ----------
const FULL_ASPECT_RECIPES = {
  aer: [],
  terra: [],
  ignis: [],
  aqua: [],
  ordo: [],
  perditio: [],
  vacuos: ["aer", "perditio"],
  lux: ["aer", "ignis"],
  potentia: ["ordo", "ignis"],
  motus: ["aer", "ordo"],
  gelum: ["ignis", "perditio"],
  vitreus: ["terra", "ordo"],
  victus: ["aqua", "terra"],
  venenum: ["aqua", "perditio"],
  permutatio: ["perditio", "ordo"],
  metallum: ["terra", "vitreus"],
  mortuus: ["victus", "perditio"],
  volatus: ["aer", "motus"],
  tenebrae: ["vacuos", "lux"],
  spiritus: ["victus", "mortuus"],
  sano: ["ordo", "victus"],
  iter: ["motus", "terra"],
  alienis: ["vacuos", "tenebrae"],
  praecantatio: ["vacuos", "potentia"],
  auram: ["praecantatio", "aer"],
  vitium: ["praecantatio", "perditio"],
  limus: ["victus", "aqua"],
  herba: ["victus", "terra"],
  arbor: ["aer", "herba"],
  bestia: ["motus", "victus"],
  corpus: ["mortuus", "bestia"],
  exanimis: ["motus", "mortuus"],
  cognitio: ["ignis", "spiritus"],
  sensus: ["aer", "spiritus"],
  humanus: ["bestia", "cognitio"],
  messis: ["herba", "humanus"],
  perfodio: ["humanus", "terra"],
  instrumentum: ["humanus", "ordo"],
  meto: ["messis", "instrumentum"],
  telum: ["instrumentum", "ignis"],
  tutamen: ["instrumentum", "terra"],
  fames: ["victus", "vacuos"],
  lucrum: ["humanus", "fames"],
  fabrico: ["humanus", "instrumentum"],
  pannus: ["instrumentum", "bestia"],
  machina: ["motus", "instrumentum"],
  vinculum: ["motus", "perditio"],
  tempestas: ["aer", "aqua"],
  tempus: ["vacuos", "ordo"],
  gula: ["fames", "vacuos"],
  infernus: ["ignis", "praecantatio"],
  ira: ["telum", "ignis"],
  luxuria: ["corpus", "fames"],
  superbia: ["volatus", "vacuos"],
  desidia: ["vinculum", "spiritus"],
  invidia: ["sensus", "fames"],
  terminus: ["lucrum", "alienis"],
};

const chainCache = new Map();
const connectionCache = new Map();

const ASPECT_RECIPES = {
  ...FULL_ASPECT_RECIPES,
};
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

  const queue = [
    {
      node: startAsp,
      path: [startAsp],
      depth: 0,
    },
  ];
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
        path: [...cur.path, nb],
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

  const queue = [
    {
      key: startKey,
      path: [startKey],
      visitedSet: new Set([startKey]),
    },
  ];
  let head = 0;

  while (head < queue.length) {
    const { key, path, visitedSet } = queue[head++];
    const depth = path.length - 1;

    if (depth === exactEdges && key === endKey) {
      connectionCache.set(cacheKey, path);
      return path;
    }
    if (depth >= exactEdges) continue;

    const [x, y] = key.split(",").map(Number);
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
        visitedSet: newVisited,
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
  clearUsedAspectsHighlight();
  if (cleared > 0) {
    redraw();
    scheduleTableRefresh(); // добавляем
    log(`🧹 Удалено ${cleared} автоматически созданных аспектов.`, "info");
  }
}

function connectAllAspects() {
  clearUsedAspectsHighlight(); // очищаем предыдущую подсветку
  chainCache.clear();
  clearPathCache();
  clearGeneratedAspects();

  const placed = [];
  for (const [key, cell] of gridState) {
    if (cell.aspect && !cell.generated) {
      placed.push({
        key,
        aspect: cell.aspect,
      });
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
            shortestPath: shortestPath,
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
      const chain = findAspectChainOfLength(
        best.fromAsp,
        best.toAsp,
        targetLen,
        aspectGraph,
      );
      if (!chain) continue;
      const path = findPathOfExactLength(best.fromKey, best.toKey, targetLen);
      if (!path) continue;
      finalPath = path;
      finalChain = chain;
      usedLength = targetLen;
      break;
    }
    addUsedAspects(finalChain);
    if (!finalPath || !finalChain) {
      log(
        `Не удалось соединить ${best.fromAsp} → ${best.toAsp} даже с удлинением`,
        "error",
      );
      network.add(best.toKey);
      remaining.splice(
        remaining.findIndex((x) => x.key === best.toKey),
        1,
      );
      continue;
    }

    const cells = finalPath.slice(1, -1);
    const aspects = finalChain.slice(1, -1);

    if (cells.length !== aspects.length) {
      log(
        `Ошибка: несовпадение длины (клеток=${cells.length}, аспектов=${aspects.length})`,
        "error",
      );
      network.add(best.toKey);
      remaining.splice(
        remaining.findIndex((x) => x.key === best.toKey),
        1,
      );
      continue;
    }

    for (let i = 0; i < cells.length; i++) {
      const cell = gridState.get(cells[i]);
      if (!cell.aspect) {
        cell.aspect = aspects[i];
        cell.generated = true;
        totalAdded++;
      } else if (!cell.generated && cell.aspect !== aspects[i]) {
        log(
          `Конфликт: на ${cells[i]} уже есть пользовательский аспект ${cell.aspect}, пропускаем`,
          "warn",
        );
        continue;
      } else if (cell.generated && cell.aspect !== aspects[i]) {
        cell.aspect = aspects[i];
      }
    }

    network.add(best.toKey);
    for (const key of finalPath) {
      network.add(key);
    }

    const targetIndex = remaining.findIndex((x) => x.key === best.toKey);
    if (targetIndex !== -1) {
      remaining.splice(targetIndex, 1);
    }

    log(
      `🔗 ${best.fromAsp} → ${best.toAsp} (длина пути ${usedLength} рёбер)`,
      "info",
    );
  }

  redraw();
  scheduleTableRefresh(); // вместо refreshAspectsTable()
  log(`✅ Готово. Добавлено новых аспектов: ${totalAdded}`, "success");
}

function clearAllAspects() {
  for (const cell of gridState.values()) {
    cell.aspect = null;
    cell.generated = false;
  }
  clearUsedAspectsHighlight();
  redraw();
  scheduleTableRefresh(); // добавляем
  log("🧹 Все аспекты (и ручные, и автоматические) удалены.", "info");
}

function exportState() {
  const activeCells = [];
  const aspectCells = [];
  for (const [key, cell] of gridState) {
    if (cell.active) activeCells.push(key);
    if (cell.aspect && !cell.generated)
      aspectCells.push(`${key}:${cell.aspect}`);
  }
  const data = {
    version: "full_aspects_4.3",
    radius: currentRadius,
    activeCells,
    aspectCells,
  };
  const exportText = document.getElementById("exportText");
  exportText.value = JSON.stringify(data, null, 2);
  document.getElementById("exportArea").style.display = "block";
  log("📦 Состояние экспортировано (только пользовательские аспекты).", "info");
}

function importState() {
  const importText = document.getElementById("importText").value.trim();
  if (!importText) {
    log("⚠️ Вставьте JSON состояние в поле импорта.", "error");
    return;
  }
  let data;
  try {
    data = JSON.parse(importText);
  } catch {
    log("❌ Ошибка парсинга JSON.", "error");
    return;
  }
  if (!data.version || !data.version.startsWith("full_aspects")) {
    log("❌ Неподдерживаемая версия данных.", "error");
    return;
  }
  const radius = data.radius || 4;
  if (radius < 2 || radius > 9) {
    log("❌ Радиус должен быть от 2 до 9.", "error");
    return;
  }
  generateGrid(radius);
  document.getElementById("radiusInput").value = radius;

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
        log(`⚠️ Клетка ${key} отсутствует, пропущена.`, "warn");
      }
    }
  }
  if (Array.isArray(data.aspectCells)) {
    for (const item of data.aspectCells) {
      const [key, aspect] = item.split(":");
      if (gridState.has(key) && ALL_ASPECTS.includes(aspect)) {
        const cell = gridState.get(key);
        cell.active = true;
        cell.aspect = aspect;
        cell.generated = false;
      } else {
        log(`⚠️ Не удалось разместить ${item}.`, "warn");
      }
    }
  }
  redraw();
  scheduleTableRefresh(); // ДОБАВИТЬ ЭТУ СТРОКУ
  log(`📥 Состояние загружено (радиус ${radius})`, "success");
}

function log(msg, type = "info") {
  const logDiv = document.getElementById("log");
  const div = document.createElement("div");
  div.textContent = msg;
  div.style.marginBottom = "4px";
  div.style.paddingLeft = "6px";
  if (type === "error") {
    div.style.borderLeft = "2px solid #ff7777";
    div.style.color = "#ffb7b7";
  } else if (type === "success") {
    div.style.borderLeft = "2px solid #77ff77";
    div.style.color = "#c6ffb3";
  } else {
    div.style.borderLeft = "2px solid #88aaff";
    div.style.color = "#ddd";
  }
  logDiv.appendChild(div);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// ========== ТАБЛИЦА АСПЕКТОВ ==========
let currentUsedAspects = new Set();
let currentUserAspects = new Set();
let isTableInitialized = false;

function updateAspectsTable() {
  const container = document.getElementById("aspects-grid");
  if (!container) return;

  // Собираем актуальные аспекты с поля
  const userAspects = new Set();

  for (const cell of gridState.values()) {
    if (cell.aspect && !cell.generated) {
      userAspects.add(cell.aspect);
    }
  }

  currentUserAspects = userAspects;

  // Строим таблицу с 5 строками (по 5 аспектов в столбце)
  container.innerHTML = "";

  const COLUMN_SIZE = 5;
  const columns = Math.ceil(ALL_ASPECTS.length / COLUMN_SIZE);

  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < COLUMN_SIZE; row++) {
      const index = row + col * COLUMN_SIZE;
      if (index >= ALL_ASPECTS.length) continue;

      const aspect = ALL_ASPECTS[index];
      const isUsed = currentUsedAspects.has(aspect);
      const isUser = userAspects.has(aspect);

      const div = document.createElement("div");
      div.className = "aspect-item";
      div.setAttribute("data-aspect", aspect);

      if (isUsed && isUser) {
        div.classList.add("both");
      } else if (isUsed) {
        div.classList.add("used");
      } else if (isUser) {
        div.classList.add("user-placed");
      }

      const img = document.createElement("img");
      const aspectImg = aspectImages.get(aspect);
      if (aspectImg && aspectImg.src) {
        img.src = aspectImg.src;
      } else {
        img.style.display = "none";
        div.style.backgroundColor = "rgba(60, 60, 80, 0.5)";
        const fallback = document.createElement("span");
        fallback.textContent = aspect.substring(0, 2);
        fallback.style.color = "#ddd";
        fallback.style.fontSize = "10px";
        fallback.style.fontWeight = "bold";
        div.appendChild(fallback);
      }
      img.alt = aspect;

      if (aspectImg && aspectImg.src) {
        div.appendChild(img);
      }

      div.addEventListener(
        "click",
        (function (a) {
          return function () {
            currentAspect = a;
            const selectedText = document.getElementById("selectedText");
            const selectedIcon = document.getElementById("selectedIcon");
            if (selectedText) selectedText.textContent = a;
            if (selectedIcon) {
              const icon = aspectImages.get(a);
              if (icon && icon.src) {
                selectedIcon.src = icon.src;
                selectedIcon.style.display = "inline";
              } else {
                selectedIcon.style.display = "none";
              }
            }
            const dropdown = document.getElementById("selectDropdown");
            if (dropdown) dropdown.classList.remove("show");
            log(`✨ Выбран аспект "${a}" из таблицы`, "info");
          };
        })(aspect),
      );

      container.appendChild(div);
    }
  }
}

function positionAspectsPanel() {
  const panel = document.getElementById("aspects-panel");
  const grid = document.querySelector(".aspects-grid");
  if (!panel || !grid) return;

  // Находим самую правую клетку сетки
  let maxPixelX = -Infinity;

  for (const [key] of gridState) {
    const [x, y] = key.split(",").map(Number);
    const { px } = hexToPixel(x, y);
    if (px > maxPixelX) {
      maxPixelX = px;
    }
  }

  if (maxPixelX === -Infinity) return;

  // Размер гекса и отступ в 1 клетку
  const hexWidth = HEX_SIZE * 1.5;
  const gap = hexWidth;

  // Панель справа от самой правой клетки + отступ
  const panelLeft = maxPixelX + gap;

  // Получаем количество столбцов в таблице
  const columns = Math.ceil(ALL_ASPECTS.length / 5);
  const cellWidth = 68; // ширина одной ячейки (60px + gap 8px)
  const tableWidth = columns * cellWidth;

  // Доступное место справа от сетки
  const availableWidth = window.innerWidth - panelLeft - 10;

  // Определяем, нужна ли прокрутка
  const needsScroll = tableWidth > availableWidth;

  // Устанавливаем позицию и ширину панели
  panel.style.position = "fixed";
  panel.style.left = `${panelLeft}px`;
  panel.style.display = "block";

  if (needsScroll) {
    // Если не помещается - фиксированная ширина и прокрутка
    const maxWidth = Math.max(150, availableWidth);
    panel.style.width = `${maxWidth}px`;
    grid.style.overflowX = "auto";
    grid.style.width = "100%";
  } else {
    // Если помещается - ширина по содержимому
    panel.style.width = "auto";
    grid.style.overflowX = "visible";
    grid.style.width = "fit-content";
  }

  // Высота: 5 строк по 60px + отступы (gap 8px * 4 = 32px)
  const rowHeight = 60;
  const gapSize = 8;
  const rows = 5;
  const gridHeight = rows * rowHeight + (rows - 1) * gapSize + 10;
  const panelHeight = gridHeight + 40;
  const panelTop = Math.max(10, (window.innerHeight - panelHeight) / 2);

  panel.style.top = `${panelTop}px`;
  panel.style.height = `${panelHeight}px`;
  panel.style.overflow = "visible";

  grid.style.maxHeight = `${gridHeight}px`;
  grid.style.overflowY = "hidden";
}
// Горизонтальная прокрутка таблицы колесиком мыши
function initTableScroll() {
  const grid = document.querySelector(".aspects-grid");
  if (!grid) return;

  // Удаляем старый обработчик, если был
  grid.removeEventListener("wheel", grid._wheelHandler);

  // Создаём новый обработчик
  grid._wheelHandler = (e) => {
    // Если есть горизонтальная прокрутка и нужно прокрутить
    if (grid.scrollWidth > grid.clientWidth && e.deltaY !== 0) {
      e.preventDefault();
      grid.scrollLeft += e.deltaY;
    }
  };

  grid.addEventListener("wheel", grid._wheelHandler);
}

// ========== ГЛОБАЛЬНЫЙ ТУЛТИП ДЛЯ ТАБЛИЦЫ ==========
function initGlobalTooltip() {
  const tooltip = document.getElementById("global-tooltip");
  if (!tooltip) return;

  function showTooltip(text, x, y) {
    tooltip.textContent = text;
    tooltip.style.display = "block";
    tooltip.style.left = x + 15 + "px";
    tooltip.style.top = y - 35 + "px";
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  // Делегирование событий на контейнере таблицы
  const container = document.getElementById("aspects-grid");
  if (!container) return;

  container.addEventListener("mouseover", (e) => {
    const aspectItem = e.target.closest(".aspect-item");
    if (aspectItem) {
      const aspect = aspectItem.getAttribute("data-aspect");
      if (aspect) {
        const rect = aspectItem.getBoundingClientRect();
        showTooltip(aspect, rect.left + rect.width / 2, rect.top);
      }
    }
  });

  container.addEventListener("mouseout", (e) => {
    const aspectItem = e.target.closest(".aspect-item");
    if (aspectItem) {
      hideTooltip();
    }
  });
}

// Вызываем после обновления таблицы
function refreshAspectsTable() {
  updateAspectsTable();
  // Даём браузеру время на отрисовку таблицы
  setTimeout(() => {
    positionAspectsPanel();
  }, 10);
  initGlobalTooltip();
}

// Вызываем после загрузки страницы и после каждого изменения сетки
function scheduleTableRefresh() {
  setTimeout(() => {
    refreshAspectsTable();
    initTableScroll(); // добавляем
  }, 50);
}

// Очищаем подсветку использованных аспектов
function clearUsedAspectsHighlight() {
  currentUsedAspects.clear();
  updateAspectsTable();
}

// Добавляем аспекты в список использованных
function addUsedAspects(aspectsList) {
  aspectsList.forEach((aspect) => currentUsedAspects.add(aspect));
  updateAspectsTable();
}

function loadAspectImages() {
  let loadedCount = 0;
  ALL_ASPECTS.forEach((aspect) => {
    const img = new Image();
    img.src = `color/${aspect}.png`;
    img.onload = () => {
      aspectImages.set(aspect, img);
      loadedCount++;
      redraw();
      if (loadedCount === ALL_ASPECTS.length) {
        log(`🖼️ Загружены все иконки аспектов (${loadedCount})`, "success");
        initCustomSelect();
        scheduleTableRefresh(); // вместо refreshAspectsTable()
      }
    };
    img.onerror = () => {
      // Если иконка не найдена, используем текстовый fallback
      aspectImages.set(aspect, null);
      loadedCount++;
      if (loadedCount === ALL_ASPECTS.length) {
        log(`🖼️ Загружены все иконки аспектов (${loadedCount})`, "success");
        initCustomSelect();
        // Даём время на отрисовку иконок
        setTimeout(() => {
          refreshAspectsTable();
        }, 100);
      }
    };
  });
}

// ========== КАСТОМНЫЙ SELECT С ИКОНКАМИ ==========
let currentAspect = "aer";

function initCustomSelect() {
  const selectDropdown = document.getElementById("selectDropdown");
  const selectedText = document.getElementById("selectedText");
  const selectedIcon = document.getElementById("selectedIcon");

  if (!selectDropdown) return;

  selectDropdown.innerHTML = "";

  ALL_ASPECTS.forEach((aspect) => {
    const option = document.createElement("div");
    option.className = "select-option";
    if (aspect === currentAspect) option.classList.add("selected");

    const img = document.createElement("img");
    const iconImg = aspectImages.get(aspect);
    if (iconImg) {
      img.src = iconImg.src;
      img.style.width = "24px";
      img.style.height = "24px";
    } else {
      img.style.display = "none";
    }
    img.alt = aspect;

    const text = document.createElement("span");
    text.textContent = aspect;

    option.appendChild(img);
    option.appendChild(text);

    option.addEventListener("click", () => {
      currentAspect = aspect;
      selectedText.textContent = aspect;
      const selectedIconImg = aspectImages.get(aspect);
      if (selectedIconImg) {
        selectedIcon.src = selectedIconImg.src;
        selectedIcon.style.display = "inline";
      } else {
        selectedIcon.style.display = "none";
      }

      document
        .querySelectorAll(".select-option")
        .forEach((opt) => opt.classList.remove("selected"));
      option.classList.add("selected");

      selectDropdown.classList.remove("show");
    });

    selectDropdown.appendChild(option);
  });

  selectedText.textContent = currentAspect;
  const firstIcon = aspectImages.get(currentAspect);
  if (firstIcon) {
    selectedIcon.src = firstIcon.src;
    selectedIcon.style.display = "inline";
  }
}

// Инициализация
document.addEventListener("DOMContentLoaded", () => {
  const radiusInput = document.getElementById("radiusInput");
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

    if (currentMode === "activate" && !cell.active) {
      cell.active = true;
      redraw();
    } else if (currentMode === "deactivate" && cell.active) {
      cell.active = false;
      cell.aspect = null;
      cell.generated = false;
      redraw();
    }
  }

  canvas.addEventListener("mousedown", (e) => {
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
        currentMode = cell.active ? "deactivate" : "activate";
        updateCellState(key);
      }
      e.preventDefault();
    }
  });

  canvas.addEventListener("mouseup", () => {
    isMouseDown = false;
    currentMode = null;
  });

  canvas.addEventListener("mousemove", (e) => {
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
  const tooltip = document.getElementById("aspect-tooltip");

  canvas.addEventListener("mousemove", (e) => {
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
      tooltip.style.opacity = "1";
      tooltip.style.left = e.clientX + 15 + "px";
      tooltip.style.top = e.clientY - 30 + "px";
    } else {
      tooltip.style.opacity = "0";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.style.opacity = "0";
  });

  // ========== ПКМ (установка аспекта) ==========
  canvas.addEventListener("contextmenu", (e) => {
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
      log(`📌 Установлен "${cell.aspect}" на (${hex.x},${hex.y})`, "info");
    } else if (cell && !cell.active) {
      log(`❌ Сначала активируйте клетку (зажмите ЛКМ и проведите).`, "error");
    }
    return false;
  });

  // ========== КНОПКИ ==========
  document
    .getElementById("calculateBtn")
    .addEventListener("click", connectAllAspects);
  document
    .getElementById("clearBtn")
    .addEventListener("click", clearAllAspects);
  document.getElementById("exportBtn").addEventListener("click", exportState);
  document.getElementById("copyBtn").addEventListener("click", () => {
    const exportText = document.getElementById("exportText");
    exportText.select();
    document.execCommand("copy");
    log("📋 JSON скопирован.", "success");
  });
  document.getElementById("importBtn").addEventListener("click", importState);

  radiusInput.addEventListener("change", () => {
    let newRadius = parseInt(radiusInput.value, 10);
    if (isNaN(newRadius) || newRadius < 2) newRadius = 2;
    if (newRadius > 9) newRadius = 9;
    generateGrid(newRadius);
    clearPathCache();
    redraw();
    scheduleTableRefresh(); // вместо refreshAspectsTable()
    log(`🌐 Радиус изменён на ${newRadius}.`, "info");
  });

  // Обработчики кастомного select
  const selectTrigger = document.getElementById("selectTrigger");
  const selectDropdown = document.getElementById("selectDropdown");

  if (selectTrigger) {
    selectTrigger.addEventListener("click", () => {
      selectDropdown.classList.toggle("show");
    });
  }

  document.addEventListener("click", (e) => {
    if (
      selectTrigger &&
      !selectTrigger.contains(e.target) &&
      selectDropdown &&
      !selectDropdown.contains(e.target)
    ) {
      selectDropdown.classList.remove("show");
    }
  });

  log(`📚 Загружено аспектов: ${ALL_ASPECTS.length} (все аддоны).`, "success");
  log(
    `💡 Зажмите ЛКМ и водите по клеткам, чтобы включать/выключать их. ПКМ для установки аспекта.`,
    "info",
  );
});

// Экспортируем для использования в grid.js
window.scheduleTableRefresh = scheduleTableRefresh;
window.refreshAspectsTable = refreshAspectsTable;
/////////////////////////////////////////////////////////
// YOLO ONNX РАСПОЗНАВАНИЕ
/////////////////////////////////////////////////////////

const INPUT = 640;
const IOU = 0.45;
const MAX_DETECTIONS = 300;

let ortSession = null;
let classNames = [];
let originalImg = null;
let conf = 0.31;

const recognitionCanvas = document.getElementById("recognitionCanvas");

const rctx = recognitionCanvas.getContext("2d");

function recogLog(msg, error = false) {
  const div = document.getElementById("log");

  const el = document.createElement("div");

  el.style.color = error ? "#ff8888" : "#88ff88";

  el.innerText = "[YOLO] " + msg;

  div.appendChild(el);

  div.scrollTop = div.scrollHeight;

  console.log(msg);
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

document.getElementById("conf").oninput = (e) => {
  conf = parseFloat(e.target.value);

  document.getElementById("confv").innerText = conf;

  if (originalImg) {
    recognizeAspects(originalImg);
  }
};

document.getElementById("clearRecognitionLog").onclick = () => {
  document.getElementById("log").innerHTML = "";
};

async function initYOLO() {
  try {
    recogLog("загрузка классов...");

    let txt = await (
      await fetch("./models/models/field_class_names.txt")
    ).text();

    classNames = txt.split(/\r?\n/).filter((x) => x.trim());

    recogLog("class=" + classNames.length);

    recogLog("загрузка модели...");

    ortSession = await ort.InferenceSession.create(
      "./models/models/field_object_detection.onnx",
    );

    recogLog("YOLO готова", false);
  } catch (e) {
    recogLog(e.message, true);
  }
}

function preprocess(img) {
  const c = document.createElement("canvas");

  c.width = INPUT;
  c.height = INPUT;

  const cx = c.getContext("2d");

  cx.fillStyle = "black";

  cx.fillRect(0, 0, INPUT, INPUT);

  let scale = Math.min(INPUT / img.width, INPUT / img.height);

  let w = img.width * scale;

  let h = img.height * scale;

  let dx = (INPUT - w) / 2;

  let dy = (INPUT - h) / 2;

  cx.drawImage(img, dx, dy, w, h);

  const pixels = cx.getImageData(0, 0, INPUT, INPUT).data;

  const size = INPUT * INPUT;

  const data = new Float32Array(3 * size);

  for (let i = 0; i < size; i++) {
    data[i] = pixels[i * 4] / 255;

    data[size + i] = pixels[i * 4 + 1] / 255;

    data[2 * size + i] = pixels[i * 4 + 2] / 255;
  }

  return {
    tensor: new ort.Tensor("float32", data, [1, 3, INPUT, INPUT]),

    scale,
    dx,
    dy,
  };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);

  const y1 = Math.max(a.y, b.y);

  const x2 = Math.min(a.x + a.w, b.x + b.w);

  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);

  const union = a.w * a.h + b.w * b.h - inter;

  return inter / union;
}

async function recognizeAspects(img) {
  if (!ortSession) return;

  try {
    const prep = preprocess(img);

    const result = await ortSession.run({
      images: prep.tensor,
    });

    const out = result.output0;

    const data = out.data;

    const dims = out.dims;

    let numChannels = dims[1];

    let numPred = dims[2];

    let det = [];

    for (let i = 0; i < numPred; i++) {
      let cx = data[0 * numPred + i];

      let cy = data[1 * numPred + i];

      let w = data[2 * numPred + i];

      let h = data[3 * numPred + i];

      let obj = sigmoid(data[4 * numPred + i]);

      if (obj < conf) continue;

      let best = 0;
      let cls = -1;

      for (let c = 0; c < classNames.length; c++) {
        let p = sigmoid(data[(c + 5) * numPred + i]);

        if (p > best) {
          best = p;
          cls = c;
        }
      }

      let score = obj * best;

      if (score < conf) continue;

      det.push({
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
        score,
        cls,
      });
    }

    det.sort((a, b) => b.score - a.score);

    let final = [];

    for (let d of det) {
      let keep = true;

      for (let f of final) {
        if (d.cls === f.cls && iou(d, f) > IOU) {
          keep = false;
          break;
        }
      }

      if (keep) final.push(d);
    }

    recognitionCanvas.width = img.width;

    recognitionCanvas.height = img.height;

    rctx.drawImage(img, 0, 0);

    const recognizedHexes = [];

    for (let d of final) {
      let x = (d.x - prep.dx) / prep.scale;

      let y = (d.y - prep.dy) / prep.scale;

      let w = d.w / prep.scale;

      let h = d.h / prep.scale;

      const name = classNames[d.cls];

      rctx.strokeStyle = "#ffaa00";

      rctx.lineWidth = 2;

      rctx.strokeRect(x, y, w, h);

      rctx.fillStyle = "#ffcc00";

      rctx.font = "14px monospace";

      rctx.fillText(
        name + " " + (d.score * 100).toFixed(1) + "%",

        x,
        y - 4,
      );

      recogLog(name + " " + (d.score * 100).toFixed(1) + "%");

      // script нам не нужен
      if (name === "script") continue;

      // сохраняем центр найденного объекта
      recognizedHexes.push({
        x: x + w / 2,
        y: y + h / 2,

        cls: name,
      });
    }

    // после завершения цикла:
    buildResearchFromDetections(recognizedHexes, img.width, img.height);
  } catch (e) {
    recogLog(e.message, true);
  }
}

function buildResearchFromDetections(items, imgWidth, imgHeight) {
  if (!items.length) return;

  generateGrid(4);

  for (const cell of gridState.values()) {
    cell.active = false;
    cell.aspect = null;
    cell.generated = false;
  }

  const activeCells = [];
  const aspectCells = [];

  const imgCenterX = imgWidth / 2;
  const imgCenterY = imgHeight / 2;

  // только пустые клетки — они образуют сетку
  const free = items
    .filter((x) => x.cls === "free_hex")
    .map((x) => ({
      x: x.x - imgCenterX,
      y: x.y - imgCenterY,
    }));

  // ---- автоопределение шага X ----

  const xs = [...new Set(free.map((v) => Math.round(v.x)))].sort(
    (a, b) => a - b,
  );

  const xDiff = [];

  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];

    if (d > 10) xDiff.push(d);
  }

  const STEP_X = xDiff.reduce((a, b) => a + b, 0) / xDiff.length;

  // ---- автоопределение шага Y ----

  const ys = [...new Set(free.map((v) => Math.round(v.y)))].sort(
    (a, b) => a - b,
  );

  const yDiff = [];

  for (let i = 1; i < ys.length; i++) {
    const d = ys[i] - ys[i - 1];

    if (d > 10) yDiff.push(d);
  }

  const STEP_Y = yDiff.reduce((a, b) => a + b, 0) / yDiff.length;

  console.log("STEP_X", STEP_X, "STEP_Y", STEP_Y);

  for (const item of items) {
    const relX = item.x - imgCenterX;

    const relY = item.y - imgCenterY;

    const hx = Math.round(relX / STEP_X);

// реальный шаг ряда
const row = Math.round(relY / (STEP_Y * 2));

const hy = row - Math.floor(hx / 2);

const key = `${hx},${hy}`;

console.log({
  cls: item.cls,
  hx,
  row,
  hy,
  key
});
    // клетки вне реальной сетки отбрасываем
    const cell = gridState.get(key);

    if (!cell) continue;

    // защита от дублей/дрожания детектора
    if (!cell.active) {
      cell.active = true;
      activeCells.push(key);
    }

    if (item.cls === "free_hex") continue;

    cell.aspect = item.cls;

    aspectCells.push(`${key}:${item.cls}`);
  }
  activeCells.sort((a, b) => {
    const [ax, ay] = a.split(",").map(Number);
    const [bx, by] = b.split(",").map(Number);

    if (ax !== bx) return ax - bx;

    return ay - by;
  });
  const state = {
    version: "full_aspects_4.3",
    radius: 4,
    activeCells,
    aspectCells,
  };

  document.getElementById("importText").value = JSON.stringify(state, null, 2);

  redraw();

  scheduleTableRefresh();

  console.log(state);

  log("📥 исследование распознано", "success");
}

document.getElementById("uploadAspects").onchange = (e) => {
  const file = e.target.files[0];

  if (!file) return;

  const img = new Image();

  img.onload = () => {
    originalImg = img;

    recognizeAspects(img);
  };

  img.src = URL.createObjectURL(file);
};

initYOLO();
