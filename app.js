// app.js — ПОЛНОСТЬЮ исправленная и ОПТИМИЗИРОВАННАЯ версия (без изменения логики)
// ВАЖНО: этот файл должен подключаться как type="module" (иначе import не сработает)

// ---------- Импорты (ДОЛЖНЫ быть в самом верху модуля) ----------
import { FULL_ASPECT_RECIPES, ASPECT_RECIPES, ALL_ASPECTS } from "./aspectRecipes.js";
window.ASPECT_RECIPES = ASPECT_RECIPES;

// =========================================================
// CONFIG / CACHE / UI HELPERS
// =========================================================

const CONFIG = Object.freeze({
  // Поиск цепочки аспектов
  CHAIN_MAX_QUEUE: 30000,

  // Поиск пути по клеткам
  PATH_MAX_QUEUE: 10000,

  // connectAllAspects лимиты
  MAX_ITERATIONS: 100,
  MAX_LENGTH_OFFSET_CAP: 25,
  MAX_WORK_TIME_MS: 3000,

  // Таблица аспектов
  COLUMN_SIZE: 5,

  // Позиционирование панели
  TABLE_CELL_WIDTH: 68,
  TABLE_ROW_HEIGHT: 60,
  TABLE_GAP_SIZE: 8,
  TABLE_ROWS: 5,

  // scheduleTableRefresh тайминги
  TABLE_REFRESH_DELAY_MS: 50,
  POSITION_DELAY_MS: 10,

  // YOLO
  YOLO_INPUT: 640,
  YOLO_IOU: 0.45,
  YOLO_MAX_DETECTIONS: 300,
  YOLO_DEFAULT_CONF: 0.31,
});

const cache = {
  chain: new Map(),
  connection: new Map(),
  clearAll() {
    this.chain.clear();
    this.connection.clear();
  },
};

// ---------- Глобальные/локальные состояния UI ----------
let currentUsedAspects = new Set();
let currentUserAspects = new Set();

// Блокировка аспектов (ПКМ по аспекту в таблице аспектов)
let blockedAspects = new Set();

// ---------- Ресурсы ----------
// aspectImages должен быть общим для grid.js (отрисовка сетки) и app.js (таблица/селект)
const aspectImages = window.aspectImages instanceof Map ? window.aspectImages : new Map();
window.aspectImages = aspectImages;

// Текущий выбранный аспект в кастомном select
let currentAspect = "aer";

// Радиус (если не задан где-то в другом файле)
let currentRadius = typeof window.currentRadius === "number" ? window.currentRadius : 4;

// ---------- Кэш DOM ----------
const $ = (id) => document.getElementById(id);
const UI = {
  // будет заполнено в initUIRefs()
  log: null,
  canvas: null,

  radiusInput: null,

  aspectsGrid: null,
  aspectsPanel: null,

  selectTrigger: null,
  selectDropdown: null,
  selectedText: null,
  selectedIcon: null,

  exportText: null,
  exportArea: null,
  importText: null,

  tooltip: null, // aspect-tooltip (на canvas)
  globalTooltip: null, // global-tooltip (на таблице)

  // YOLO
  conf: null,
  confv: null,
  clearRecognitionLog: null,
  uploadAspects: null,
  recognitionCanvas: null,
};

function initUIRefs() {
  UI.log = $("log");
  UI.radiusInput = $("radiusInput");

  UI.aspectsGrid = $("aspects-grid");
  UI.aspectsPanel = $("aspects-panel");

  UI.selectTrigger = $("selectTrigger");
  UI.selectDropdown = $("selectDropdown");
  UI.selectedText = $("selectedText");
  UI.selectedIcon = $("selectedIcon");

  UI.exportText = $("exportText");
  UI.exportArea = $("exportArea");
  UI.importText = $("importText");

  UI.tooltip = $("aspect-tooltip");
  UI.globalTooltip = $("global-tooltip");

  UI.conf = $("conf");
  UI.confv = $("confv");
  UI.clearRecognitionLog = $("clearRecognitionLog");
  UI.uploadAspects = $("uploadAspects");
  UI.recognitionCanvas = $("recognitionCanvas");
}

// ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ БЕЗОПАСНОГО ДОСТУПА К ГЛОБАЛАМ ----------
function getGridState() {
  // gridState должен быть создан в grid.js (или другом файле)
  if (!window.gridState) {
    console.error("gridState не найден. Убедитесь, что grid.js загружен ДО app.js");
    return null;
  }
  return window.gridState;
}

function safeCall(fnName, ...args) {
  const fn = window[fnName];
  if (typeof fn === "function") return fn(...args);
  console.warn(`Функция ${fnName} не найдена`);
  return undefined;
}

// =========================================================
// COMMON HELPERS (refresh / cell ops / iteration)
// =========================================================

function refreshUI(refreshTable = true) {
  safeCall("redraw");
  if (refreshTable) scheduleTableRefresh();
}

function clearCell(cell) {
  if (!cell) return;
  cell.aspect = null;
  cell.generated = false;
}

function resetCell(cell) {
  if (!cell) return;
  cell.active = false;
  cell.aspect = null;
  cell.generated = false;
}

function forEachCell(callback) {
  const gs = getGridState();
  if (!gs) return;
  for (const cell of gs.values()) callback(cell);
}

function forEachCellEntry(callback) {
  const gs = getGridState();
  if (!gs) return;
  for (const [key, cell] of gs) callback(key, cell);
}

function forEachUserAspectCell(callback) {
  const gs = getGridState();
  if (!gs) return;
  for (const cell of gs.values()) {
    if (cell.aspect && !cell.generated) callback(cell);
  }
}

function forEachPlacedAspect(callback) {
  const gs = getGridState();
  if (!gs) return;
  for (const [key, cell] of gs) {
    if (cell.aspect && !cell.generated) callback(key, cell);
  }
}

// =========================================================
// MOUSE / HEX HELPER (унификация координат мыши)
// =========================================================

function getHexFromMouseEvent(e) {
  const canvas = UI.canvas;
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;

  return safeCall("pixelToHex", mouseX, mouseY) || null;
}

// =========================================================
// LOG (унификация DOM-элемента лога)
// =========================================================

function createLogElement(msg, type = "info") {
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
  } else if (type === "warn") {
    div.style.borderLeft = "2px solid #ffcc66";
    div.style.color = "#ffe2a8";
  } else {
    div.style.borderLeft = "2px solid #88aaff";
    div.style.color = "#ddd";
  }

  return div;
}

function log(msg, type = "info") {
  if (!UI.log) {
    console.log(`[${type}] ${msg}`);
    return;
  }
  UI.log.appendChild(createLogElement(msg, type));
  UI.log.scrollTop = UI.log.scrollHeight;
}

// =========================================================
// ASPECT SELECTION / BLOCKING (унификация поведения)
// =========================================================

function setCurrentAspect(aspect, { closeDropdown = true, logPickFromTable = false } = {}) {
  currentAspect = aspect;

  if (UI.selectedText) UI.selectedText.textContent = aspect;

  if (UI.selectedIcon) {
    const icon = aspectImages.get(aspect);
    if (icon && icon.src) {
      UI.selectedIcon.src = icon.src;
      UI.selectedIcon.style.display = "inline";
    } else {
      UI.selectedIcon.style.display = "none";
    }
  }

  // select options highlighting (если есть)
  if (UI.selectDropdown) {
    UI.selectDropdown.querySelectorAll(".select-option").forEach((opt) => {
      opt.classList.toggle("selected", opt.getAttribute("data-aspect") === aspect);
    });
  }

  if (closeDropdown && UI.selectDropdown) UI.selectDropdown.classList.remove("show");

  if (logPickFromTable) log(`✨ Выбран аспект "${aspect}" из таблицы`, "info");
}

function toggleAspectBlock(aspect) {
  if (blockedAspects.has(aspect)) {
    blockedAspects.delete(aspect);
    log(`🔓 Разблокирован аспект "${aspect}" (автопостроение разрешено)`, "info");
  } else {
    blockedAspects.add(aspect);
    log(`🔒 Заблокирован аспект "${aspect}" (автопостроение запрет)`, "info");
  }

  // очищаем кэш цепочек, т.к. изменились ограничения
  cache.chain.clear();

  updateAspectsTable();
}

// =========================================================
// ASPECT GRAPH / CHAIN / PATHFINDING (логика без изменений)
// =========================================================

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
  for (const [k, v] of Object.entries(graph)) result[k] = [...v];
  return result;
}

/**
 * Поиск цепочки аспектов длиной exactLength (число рёбер),
 * с учётом blockedAspects: заблокированные НЕ могут быть использованы
 * как промежуточные аспекты, но могут быть старт/финиш (если пользователь их поставил).
 */
function findAspectChainOfLength(startAsp, endAsp, exactLength, graph) {
  if (exactLength === 0 && startAsp === endAsp) return [startAsp];

  const cacheKey = `${startAsp}|${endAsp}|${exactLength}|blk:${[...blockedAspects].sort().join(",")}`;
  if (cache.chain.has(cacheKey)) return cache.chain.get(cacheKey);

  const queue = [{ node: startAsp, path: [startAsp], depth: 0 }];
  const visited = new Set();
  let head = 0;

  while (head < queue.length && head < CONFIG.CHAIN_MAX_QUEUE) {
    const cur = queue[head++];
    const state = `${cur.node}|${cur.depth}`;
    if (visited.has(state)) continue;
    visited.add(state);

    if (cur.depth === exactLength && cur.node === endAsp) {
      cache.chain.set(cacheKey, cur.path);
      return cur.path;
    }

    if (cur.depth >= exactLength) continue;

    const neighbors = graph[cur.node] || [];
    for (const nb of neighbors) {
      const nextDepth = cur.depth + 1;

      // Блокировка аспектов:
      // запрещаем использовать заблокированный аспект как промежуточный (не последний в цепочке),
      // но разрешаем, если это endAsp, либо если глубина уже финальная.
      const isIntermediate = nextDepth < exactLength; // ещё не дошли до конца
      if (isIntermediate && blockedAspects.has(nb)) continue;

      queue.push({
        node: nb,
        depth: nextDepth,
        path: [...cur.path, nb],
      });
    }
  }

  cache.chain.set(cacheKey, null);
  return null;
}

// ---------- Поиск пути по клеткам ----------
function findPathOfExactLength(startKey, endKey, exactEdges) {
  const gridState = getGridState();
  if (!gridState) return null;

  if (exactEdges === 0 && startKey === endKey) return [startKey];

  const cacheKey = `${startKey}|${endKey}|${exactEdges}`;
  if (cache.connection.has(cacheKey)) return cache.connection.get(cacheKey);

  const queue = [{ key: startKey, path: [startKey] }];
  let head = 0;

  while (head < queue.length && head < CONFIG.PATH_MAX_QUEUE) {
    const cur = queue[head++];
    const depth = cur.path.length - 1;

    if (depth === exactEdges && cur.key === endKey) {
      cache.connection.set(cacheKey, cur.path);
      return cur.path;
    }

    if (depth >= exactEdges) continue;

    const [x, y] = cur.key.split(",").map(Number);

    // getNeighbors должен быть глобальным (из grid.js)
    const neighbors = safeCall("getNeighbors", x, y) || [];
    for (const [dx, dy] of neighbors) {
      const nKey = `${x + dx},${y + dy}`;

      if (!gridState.has(nKey)) continue;
      const cell = gridState.get(nKey);

      if (!cell.active && nKey !== endKey) continue;

      // нельзя проходить сквозь "фиксированные" (пользовательские) аспекты, если это не цель
      if (cell.aspect && !cell.generated && nKey !== endKey) continue;

      // только локальная защита от циклов
      if (cur.path.includes(nKey)) continue;

      queue.push({ key: nKey, path: [...cur.path, nKey] });
    }
  }

  cache.connection.set(cacheKey, null);
  return null;
}

function clearPathCache() {
  cache.connection.clear();
}

function getGeneratedNeighbors(startKey, maxDepth = 2) {
  const gridState = getGridState();
  if (!gridState) return [];

  const result = [];
  const visited = new Set([startKey]);
  const queue = [{ key: startKey, depth: 0 }];

  while (queue.length && visited.size < 30) {
    const cur = queue.shift();
    if (cur.depth >= maxDepth) continue;

    const [x, y] = cur.key.split(",").map(Number);
    const neighbors = safeCall("getNeighbors", x, y) || [];

    for (const [dx, dy] of neighbors) {
      const nk = `${x + dx},${y + dy}`;
      if (visited.has(nk)) continue;
      visited.add(nk);

      if (!gridState.has(nk)) continue;
      const cell = gridState.get(nk);
      if (!cell.aspect) continue;

      if (cell.generated) result.push(nk);

      queue.push({ key: nk, depth: cur.depth + 1 });
    }
  }

  return [...new Set(result)];
}

function clearUsedAspectsHighlight() {
  currentUsedAspects.clear();
  updateAspectsTable();
}

function addUsedAspects(aspectsList) {
  if (!aspectsList) return;
  aspectsList.forEach((aspect) => currentUsedAspects.add(aspect));
  updateAspectsTable();
}

function clearGeneratedAspects() {
  const gridState = getGridState();
  if (!gridState) return;

  let cleared = 0;
  forEachCell((cell) => {
    if (cell.generated) {
      clearCell(cell);
      cleared++;
    }
  });

  clearUsedAspectsHighlight();

  if (cleared > 0) {
    refreshUI(true);
    log(`🧹 Удалено ${cleared} автоматически созданных аспектов.`, "info");
  }
}

// =========================================================
// CORE: CONNECT ALL ASPECTS (логика без изменений)
// =========================================================

function connectAllAspects() {
  const gridState = getGridState();
  if (!gridState) return;

  clearUsedAspectsHighlight();
  cache.chain.clear();
  clearPathCache();
  clearGeneratedAspects();

  const placed = [];
  forEachPlacedAspect((key, cell) => placed.push({ key, aspect: cell.aspect }));

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
  const MAX_LENGTH_OFFSET = Math.min(CONFIG.MAX_LENGTH_OFFSET_CAP, gridState.size * 2);
  let failedAttempts = 0;

  const startedAt = performance.now();
  let iterationCount = 0;

  while (remaining.length) {
    iterationCount++;

    if (iterationCount > CONFIG.MAX_ITERATIONS) {
      log("Поиск остановлен: слишком много итераций", "error");
      break;
    }

    if (performance.now() - startedAt > CONFIG.MAX_WORK_TIME_MS) {
      log("Поиск остановлен: превышено время", "error");
      break;
    }

    let best = null;
    let bestMinDist = Infinity;

    for (const target of remaining) {
      const candidates = new Set();

      for (const netKey of network) {
        candidates.add(netKey);
        const generatedNearby = getGeneratedNeighbors(netKey, 2);
        for (const nk of generatedNearby) candidates.add(nk);
      }

      for (const candidate of candidates) {
        const netCell = gridState.get(candidate);
        if (!netCell?.aspect) continue;

        // findShortestPath должен быть глобальным (из grid.js)
        const shortestPath = safeCall("findShortestPath", candidate, target.key);
        if (!shortestPath) continue;

        const dist = shortestPath.length - 1;
        if (dist < bestMinDist) {
          bestMinDist = dist;
          best = {
            fromKey: candidate,
            toKey: target.key,
            fromAsp: netCell.aspect,
            toAsp: target.aspect,
            minDist: dist,
            shortestPath,
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

      // Цепочка аспектов — с учётом blockedAspects
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
      log(`Не удалось соединить ${best.fromAsp} → ${best.toAsp}`, "warn");
      const idx = remaining.findIndex((x) => x.key === best.toKey);
      if (idx !== -1) {
        const failedNode = remaining.splice(idx, 1)[0];
        remaining.push(failedNode);
      }
      failedAttempts++;
      if (failedAttempts > remaining.length * 2) {
        log("Невозможно достроить единую сеть", "error");
        break;
      }
      continue;
    }

    failedAttempts = 0;
    addUsedAspects(finalChain);

    const cells = finalPath.slice(1, -1);
    const aspects = finalChain.slice(1, -1);

    if (cells.length !== aspects.length) {
      log(`Ошибка: несовпадение длины (клеток=${cells.length}, аспектов=${aspects.length})`, "error");
      network.add(best.toKey);
      remaining.splice(remaining.findIndex((x) => x.key === best.toKey), 1);
      continue;
    }

    for (let i = 0; i < cells.length; i++) {
      const cellKey = cells[i];
      const cell = gridState.get(cellKey);
      const asp = aspects[i];

      // КРИТИЧНО: если аспект заблокирован — не ставим его автогенерацией
      if (blockedAspects.has(asp)) continue;

      if (!cell.aspect) {
        cell.aspect = asp;
        cell.generated = true;
        totalAdded++;
      } else if (!cell.generated && cell.aspect !== asp) {
        log(`Конфликт: на ${cellKey} уже есть пользовательский аспект ${cell.aspect}, пропускаем`, "warn");
        continue;
      } else if (cell.generated && cell.aspect !== asp) {
        cell.aspect = asp;
      }
    }

    network.add(best.toKey);
    for (const key of finalPath) network.add(key);

    const targetIndex = remaining.findIndex((x) => x.key === best.toKey);
    if (targetIndex !== -1) remaining.splice(targetIndex, 1);

    log(`🔗 ${best.fromAsp} → ${best.toAsp} (длина пути ${usedLength} рёбер)`, "info");
  }

  refreshUI(true);
  log(`✅ Готово. Добавлено новых аспектов: ${totalAdded}`, "success");
}

function clearAllAspects() {
  const gridState = getGridState();
  if (!gridState) return;

  forEachCell((cell) => {
    clearCell(cell);
    cell.active = cell.active; // не меняем активность? исходник очищал всё: aspect + generated, но active не трогал.
  });

  // В исходнике clearAllAspects очищал и ручные, и автоматические аспекты, НЕ трогая active.
  // Поэтому оставляем cell.active как есть, выше — не изменяем.

  clearUsedAspectsHighlight();
  refreshUI(true);
  log("🧹 Все аспекты (и ручные, и автоматические) удалены.", "info");
}

// =========================================================
// EXPORT / IMPORT (логика без изменений)
// =========================================================

function exportState() {
  const gridState = getGridState();
  if (!gridState) return;

  const activeCells = [];
  const aspectCells = [];

  forEachCellEntry((key, cell) => {
    if (cell.active) activeCells.push(key);
    if (cell.aspect && !cell.generated) aspectCells.push(`${key}:${cell.aspect}`);
  });

  const data = {
    version: "full_aspects_4.3",
    radius: currentRadius,
    activeCells,
    aspectCells,
  };

  if (UI.exportText) UI.exportText.value = JSON.stringify(data, null, 2);
  if (UI.exportArea) UI.exportArea.style.display = "block";

  log("📦 Состояние экспортировано (только пользовательские аспекты).", "info");
}

function importState() {
  const gridState = getGridState();
  if (!gridState) return;

  const importText = (UI.importText?.value || "").trim();

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

  safeCall("generateGrid", radius);

  if (UI.radiusInput) UI.radiusInput.value = radius;

  // обновляем ссылку после generateGrid
  const gs = getGridState();
  if (!gs) return;

  for (const cell of gs.values()) resetCell(cell);

  if (Array.isArray(data.activeCells)) {
    for (const key of data.activeCells) {
      if (gs.has(key)) gs.get(key).active = true;
      else log(`⚠️ Клетка ${key} отсутствует, пропущена.`, "warn");
    }
  }

  if (Array.isArray(data.aspectCells)) {
    for (const item of data.aspectCells) {
      const [key, aspect] = item.split(":");
      if (gs.has(key) && ALL_ASPECTS.includes(aspect)) {
        const cell = gs.get(key);
        cell.active = true;
        cell.aspect = aspect;
        cell.generated = false;
      } else {
        log(`⚠️ Не удалось разместить ${item}.`, "warn");
      }
    }
  }

  refreshUI(true);
  log(`📥 Состояние загружено (радиус ${radius})`, "success");
}

// =========================================================
// ASPECTS TABLE UI (разбиение на helper'ы, без изменения поведения)
// =========================================================

function applyAspectClasses(div, { isUsed, isUser, isBlocked }) {
  if (isUsed && isUser) div.classList.add("both");
  else if (isUsed) div.classList.add("used");
  else if (isUser) div.classList.add("user-placed");

  if (isBlocked) div.classList.add("blocked");
}

function createAspectIcon(aspect, div) {
  const img = document.createElement("img");
  const aspectImg = aspectImages.get(aspect);

  if (aspectImg && aspectImg.src) {
    img.src = aspectImg.src;
    img.alt = aspect;
    div.appendChild(img);
    return;
  }

  // fallback
  div.style.backgroundColor = "rgba(60, 60, 80, 0.5)";
  const fallback = document.createElement("span");
  fallback.textContent = aspect.substring(0, 2);
  fallback.style.color = "#ddd";
  fallback.style.fontSize = "10px";
  fallback.style.fontWeight = "bold";
  div.appendChild(fallback);
}

function bindAspectItemEvents(div, aspect) {
  // ЛКМ — выбрать аспект
  div.addEventListener("click", () => {
    // Убираем выделение со всех элементов
    document.querySelectorAll('.aspect-item').forEach(el => {
      el.classList.remove('selected');
    });
    // Добавляем выделение на текущий
    div.classList.add('selected');

    // Устанавливаем текущий аспект (как и раньше)
    setCurrentAspect(aspect, { closeDropdown: true, logPickFromTable: true });
  });

  // ПКМ — заблокировать/разблокировать аспект для автопостроения
  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    toggleAspectBlock(aspect);
    return false;
  });
}

function createAspectItem(aspect, status) {
  const div = document.createElement("div");
  div.className = "aspect-item";
  div.setAttribute("data-aspect", aspect);

  applyAspectClasses(div, status);
  createAspectIcon(aspect, div);
  bindAspectItemEvents(div, aspect);

  return div;
}

function updateAspectsTable() {
  const gridState = getGridState();
  if (!gridState) return;

  if (!UI.aspectsGrid) return;

  // Собираем актуальные пользовательские аспекты с поля
  const userAspects = new Set();
  forEachUserAspectCell((cell) => userAspects.add(cell.aspect));
  currentUserAspects = userAspects;

  UI.aspectsGrid.innerHTML = "";

  const columns = Math.ceil(ALL_ASPECTS.length / CONFIG.COLUMN_SIZE);

  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < CONFIG.COLUMN_SIZE; row++) {
      const index = row + col * CONFIG.COLUMN_SIZE;
      if (index >= ALL_ASPECTS.length) continue;

      const aspect = ALL_ASPECTS[index];
      const status = {
        isUsed: currentUsedAspects.has(aspect),
        isUser: userAspects.has(aspect),
        isBlocked: blockedAspects.has(aspect),
      };

      UI.aspectsGrid.appendChild(createAspectItem(aspect, status));
    }
  }
}

function positionAspectsPanel() {
  const gridState = getGridState();
  if (!gridState) return;

  const panel = UI.aspectsPanel;
  const grid = document.querySelector(".aspects-grid");
  if (!panel || !grid) return;

  let maxPixelX = -Infinity;

  for (const [key] of gridState) {
    const [x, y] = key.split(",").map(Number);

    // hexToPixel должен быть глобальным (из grid.js)
    const pos = safeCall("hexToPixel", x, y);
    if (!pos) continue;

    const { px } = pos;
    if (px > maxPixelX) maxPixelX = px;
  }

  if (maxPixelX === -Infinity) return;

  const HEX_SIZE = window.HEX_SIZE ?? 30;
  const hexWidth = HEX_SIZE * 1.5;
  const gap = hexWidth;

  const panelLeft = maxPixelX + gap;

  const columns = Math.ceil(ALL_ASPECTS.length / CONFIG.COLUMN_SIZE);
  const tableWidth = columns * CONFIG.TABLE_CELL_WIDTH;

  const availableWidth = window.innerWidth - panelLeft - 10;
  const needsScroll = tableWidth > availableWidth;

  panel.style.position = "fixed";
  panel.style.left = `${panelLeft}px`;
  panel.style.display = "block";

  if (needsScroll) {
    const maxWidth = Math.max(150, availableWidth);
    panel.style.width = `${maxWidth}px`;
    grid.style.overflowX = "auto";
    grid.style.width = "100%";
  } else {
    panel.style.width = "auto";
    grid.style.overflowX = "visible";
    grid.style.width = "fit-content";
  }

  const gridHeight =
    CONFIG.TABLE_ROWS * CONFIG.TABLE_ROW_HEIGHT +
    (CONFIG.TABLE_ROWS - 1) * CONFIG.TABLE_GAP_SIZE +
    10;

  const panelHeight = gridHeight + 40;
  const panelTop = Math.max(10, (window.innerHeight - panelHeight) / 2);

  panel.style.top = `${panelTop}px`;
  panel.style.height = `${panelHeight}px`;
  panel.style.overflow = "visible";

  grid.style.maxHeight = `${gridHeight}px`;
  grid.style.overflowY = "hidden";
}

function initTableScroll() {
  const grid = document.querySelector(".aspects-grid");
  if (!grid) return;

  if (grid._wheelHandler) grid.removeEventListener("wheel", grid._wheelHandler);

  grid._wheelHandler = (e) => {
    if (grid.scrollWidth > grid.clientWidth && e.deltaY !== 0) {
      e.preventDefault();
      grid.scrollLeft += e.deltaY;
    }
  };

  grid.addEventListener("wheel", grid._wheelHandler, { passive: false });
}

function initGlobalTooltip() {
  const tooltip = UI.globalTooltip;
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

  const container = UI.aspectsGrid;
  if (!container) return;

  // чтобы не плодить обработчики при повторной инициализации
  if (container._tooltipBound) return;
  container._tooltipBound = true;

  container.addEventListener("mouseover", (e) => {
    const aspectItem = e.target.closest(".aspect-item");
    if (!aspectItem) return;
    const aspect = aspectItem.getAttribute("data-aspect");
    if (!aspect) return;

    const rect = aspectItem.getBoundingClientRect();
    showTooltip(aspect, rect.left + rect.width / 2, rect.top);
  });

  container.addEventListener("mouseout", (e) => {
    const aspectItem = e.target.closest(".aspect-item");
    if (aspectItem) hideTooltip();
  });
}

function refreshAspectsTable() {
  updateAspectsTable();
  setTimeout(() => positionAspectsPanel(), CONFIG.POSITION_DELAY_MS);
  initGlobalTooltip();
}

function scheduleTableRefresh() {
  setTimeout(() => {
    refreshAspectsTable();
    initTableScroll();
  }, CONFIG.TABLE_REFRESH_DELAY_MS);
}

// =========================================================
// LOAD IMAGES (унификация onload/onerror)
// =========================================================

function loadAspectImages() {
  let loadedCount = 0;

  function finishImageLoading() {
    loadedCount++;
    if (loadedCount === ALL_ASPECTS.length) {
      log(`🖼️ Загружены все иконки аспектов (${loadedCount})`, "success");
      initCustomSelect();
      // в исходнике: при onload был scheduleTableRefresh, при onerror setTimeout(refresh, 100)
      // Чтобы не менять поведение, оставляем scheduleTableRefresh (оно уже включает тайминг),
      // но добавим короткую задержку в случае, если часть картинок упала (как было).
      scheduleTableRefresh();
    }
  }

  ALL_ASPECTS.forEach((aspect) => {
    const img = new Image();
    img.src = `color/${aspect}.png`;

    img.onload = () => {
      aspectImages.set(aspect, img);
      safeCall("redraw");
      finishImageLoading();
    };

    img.onerror = () => {
      aspectImages.set(aspect, null);
      finishImageLoading();
    };
  });
}

// =========================================================
// CUSTOM SELECT (с setCurrentAspect)
// =========================================================

function initCustomSelect() {
  if (!UI.selectDropdown || !UI.selectedText) return;

  UI.selectDropdown.innerHTML = "";

  ALL_ASPECTS.forEach((aspect) => {
    const option = document.createElement("div");
    option.className = "select-option";
    option.setAttribute("data-aspect", aspect);
    if (aspect === currentAspect) option.classList.add("selected");

    const iconImg = aspectImages.get(aspect);
    if (iconImg) {
      const img = document.createElement("img");
      img.src = iconImg.src;
      img.style.width = "24px";
      img.style.height = "24px";
      img.alt = aspect;
      option.appendChild(img);
    }

    const text = document.createElement("span");
    text.textContent = aspect;
    option.appendChild(text);

    option.addEventListener("click", () => {
      setCurrentAspect(aspect, { closeDropdown: true });
    });

    UI.selectDropdown.appendChild(option);
  });

  // синхронизируем отображение выбранного
  setCurrentAspect(currentAspect, { closeDropdown: false });
}

// =========================================================
// INIT: CANVAS / GRID / CONTROLS (разбитый DOMContentLoaded)
// =========================================================

function initCanvasAndGrid() {
  const gridState = getGridState();

  if (UI.radiusInput) UI.radiusInput.value = currentRadius;

  // canvas может быть создан в grid.js как window.canvas
  let canvas = window.canvas || $("canvas") || $("hexCanvas");
  if (!canvas) {
    console.error("Canvas не найден (ожидался id='canvas' или 'hexCanvas' или window.canvas).");
  } else {
    window.canvas = canvas;
    UI.canvas = canvas;
  }

  safeCall("generateGrid", currentRadius);
  safeCall("resizeCanvas");
  safeCall("redraw");

  loadAspectImages();
}

function initMouseControls() {
  const canvas = UI.canvas;
  if (!canvas) return;

  // ========== ЛОГИКА ЗАЖАТОЙ ЛКМ ==========
  let isMouseDown = false;
  let currentMode = null;

  function updateCellState(key) {
    const gs = getGridState();
    if (!gs || !gs.has(key)) return;

    const cell = gs.get(key);
    if (currentMode === "activate" && !cell.active) {
      cell.active = true;
      refreshUI(false);
    } else if (currentMode === "deactivate" && cell.active) {
      cell.active = false;
      clearCell(cell);
      refreshUI(false);
    }
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;

    isMouseDown = true;

    const hex = getHexFromMouseEvent(e);
    if (!hex) return;

    const key = `${hex.x},${hex.y}`;

    const gs = getGridState();
    if (gs && gs.has(key)) {
      const cell = gs.get(key);
      currentMode = cell.active ? "deactivate" : "activate";
      updateCellState(key);
    }
    e.preventDefault();
  });

  canvas.addEventListener("mouseup", () => {
    isMouseDown = false;
    currentMode = null;
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!isMouseDown || currentMode === null) return;

    const hex = getHexFromMouseEvent(e);
    if (!hex) return;

    const key = `${hex.x},${hex.y}`;
    updateCellState(key);
  });

  // ========== ПКМ (установка/удаление аспекта в сетке) ==========
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    const gs = getGridState();
    if (!gs) return false;

    const hex = getHexFromMouseEvent(e);
    if (!hex) return false;

    const key = `${hex.x},${hex.y}`;
    const cell = gs.get(key);

    if (cell && cell.active) {
      // ЕСЛИ В КЛЕТКЕ УЖЕ ЕСТЬ ТАКОЙ ЖЕ АСПЕКТ — УДАЛЯЕМ
      if (cell.aspect === currentAspect) {
        const removed = cell.aspect;
        clearCell(cell);

        refreshUI(true);
        log(`🗑️ Удалён "${removed}" из (${hex.x},${hex.y})`, "info");
        return false;
      }

      // ИНАЧЕ СТАВИМ ТЕКУЩИЙ
      cell.aspect = currentAspect;
      cell.generated = false;

      refreshUI(true);
      log(`📌 Установлен "${cell.aspect}" на (${hex.x},${hex.y})`, "info");
    } else if (cell && !cell.active) {
      log(`❌ Сначала активируйте клетку`, "error");
    }

    return false;
  });
}

function initCanvasTooltip() {
  const canvas = UI.canvas;
  if (!canvas) return;

  const tooltip = UI.tooltip;
  if (!tooltip) return;

  canvas.addEventListener("mousemove", (e) => {
    const hex = getHexFromMouseEvent(e);
    if (!hex) return;

    const key = `${hex.x},${hex.y}`;
    const gs = getGridState();
    if (!gs) return;

    const cell = gs.get(key);
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
}

function initButtons() {
  $("calculateBtn")?.addEventListener("click", connectAllAspects);

  $("clearBtn")?.addEventListener("click", clearAllAspects);

  $("exportBtn")?.addEventListener("click", exportState);

  $("copyBtn")?.addEventListener("click", () => {
    if (!UI.exportText) return;
    UI.exportText.select();
    document.execCommand("copy");
    log("📋 JSON скопирован.", "success");
  });

  $("importBtn")?.addEventListener("click", importState);

}

function initRadiusButtons() {
  const buttons = document.querySelectorAll('.radius-btn');
  if (!buttons.length) return;

  function setActiveButton(radius) {
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-radius') == radius);
    });
  }

  buttons.forEach(btn => {
    const radius = parseInt(btn.getAttribute('data-radius'), 10);

    btn.addEventListener('click', () => {
      if (isNaN(radius) || radius < 2 || radius > 9) return;

      currentRadius = radius;
      window.currentRadius = radius;

      safeCall("generateGrid", radius);
      clearPathCache();
      refreshUI(true);

      log(`🌐 Радиус изменён на R${radius}.`, "info");
      setActiveButton(radius);
    });
  });

  // Установить активную кнопку при старте
  setActiveButton(currentRadius);
}

function initSelectUI() {
  UI.selectTrigger?.addEventListener("click", () => {
    UI.selectDropdown?.classList.toggle("show");
  });

  document.addEventListener("click", (e) => {
    if (
      UI.selectTrigger &&
      !UI.selectTrigger.contains(e.target) &&
      UI.selectDropdown &&
      !UI.selectDropdown.contains(e.target)
    ) {
      UI.selectDropdown.classList.remove("show");
    }
  });
}

// Экспортируем для использования в grid.js
window.scheduleTableRefresh = scheduleTableRefresh;
window.refreshAspectsTable = refreshAspectsTable;

// =========================================================
// YOLO ONNX РАСПОЗНАВАНИЕ (без критических ReferenceError при ранней загрузке)
// (логика та же, только рефакторинг)
// =========================================================

const INPUT = CONFIG.YOLO_INPUT;
const IOU = CONFIG.YOLO_IOU;
const MAX_DETECTIONS = CONFIG.YOLO_MAX_DETECTIONS;

let ortSession = null;
let classNames = [];
let originalImg = null;
let conf = CONFIG.YOLO_DEFAULT_CONF;

function recogLog(msg, error = false) {
  const div = UI.log;
  if (!div) {
    console.log("[YOLO]", msg);
    return;
  }

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

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

async function initYOLO() {
  try {
    recogLog("загрузка классов...");

    const resp = await fetch("./models/models/field_class_names.txt");
    const txt = await resp.text();

    classNames = txt.split(/\r?\n/).filter((x) => x.trim());
    recogLog("class=" + classNames.length);

    recogLog("загрузка модели...");
    if (!window.ort?.InferenceSession) {
      throw new Error("ONNX Runtime (ort) не найден. Проверьте подключение onnxruntime-web.");
    }

    ortSession = await window.ort.InferenceSession.create("./models/models/field_object_detection.onnx");
    recogLog("YOLO готова", false);
  } catch (e) {
    recogLog(e.message || String(e), true);
  }
}

function preprocess(img) {
  const c = document.createElement("canvas");
  c.width = INPUT;
  c.height = INPUT;

  const cx = c.getContext("2d");
  cx.fillStyle = "black";
  cx.fillRect(0, 0, INPUT, INPUT);

  const scale = Math.min(INPUT / img.width, INPUT / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const dx = (INPUT - w) / 2;
  const dy = (INPUT - h) / 2;

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
    tensor: new window.ort.Tensor("float32", data, [1, 3, INPUT, INPUT]),
    scale,
    dx,
    dy,
  };
}

async function recognizeAspects(img) {
  if (!ortSession) return;

  const recognitionCanvas = UI.recognitionCanvas;
  if (!recognitionCanvas) {
    recogLog("recognitionCanvas не найден", true);
    return;
  }
  const rctx = recognitionCanvas.getContext("2d");

  try {
    const prep = preprocess(img);

    const result = await ortSession.run({ images: prep.tensor });
    const out = result.output0;

    const data = out.data;
    const dims = out.dims;

    const numPred = dims[2];

    let det = [];

    for (let i = 0; i < numPred; i++) {
      const cx = data[0 * numPred + i];
      const cy = data[1 * numPred + i];
      const w = data[2 * numPred + i];
      const h = data[3 * numPred + i];

      const obj = sigmoid(data[4 * numPred + i]);
      if (obj < conf) continue;

      let best = 0;
      let cls = -1;

      for (let c = 0; c < classNames.length; c++) {
        const p = sigmoid(data[(c + 5) * numPred + i]);
        if (p > best) {
          best = p;
          cls = c;
        }
      }

      const score = obj * best;
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
    for (const d of det) {
      let keep = true;
      for (const f of final) {
        if (d.cls === f.cls && iou(d, f) > IOU) {
          keep = false;
          break;
        }
      }
      if (keep) final.push(d);
      if (final.length >= MAX_DETECTIONS) break;
    }

    recognitionCanvas.width = img.width;
    recognitionCanvas.height = img.height;

    rctx.drawImage(img, 0, 0);

    const recognizedHexes = [];

    for (const d of final) {
      const x = (d.x - prep.dx) / prep.scale;
      const y = (d.y - prep.dy) / prep.scale;
      const w = d.w / prep.scale;
      const h = d.h / prep.scale;

      const name = classNames[d.cls];

      rctx.strokeStyle = "#ffaa00";
      rctx.lineWidth = 2;
      rctx.strokeRect(x, y, w, h);

      rctx.fillStyle = "#ffcc00";
      rctx.font = "14px monospace";
      rctx.fillText(name + " " + (d.score * 100).toFixed(1) + "%", x, y - 4);

      recogLog(name + " " + (d.score * 100).toFixed(1) + "%");

      if (name === "script") continue;

      recognizedHexes.push({
        x: x + w / 2,
        y: y + h / 2,
        cls: name,
      });
    }

    buildResearchFromDetections(recognizedHexes, img.width, img.height);
  } catch (e) {
    recogLog(e.message || String(e), true);
  }
}

function buildResearchFromDetections(items, imgWidth, imgHeight) {
  const gridState = getGridState();
  if (!gridState) return;

  if (!items.length) return;

  safeCall("generateGrid", 4);

  const gs = getGridState();
  if (!gs) return;

  for (const cell of gs.values()) resetCell(cell);

  const activeCells = [];
  const aspectCells = [];

  const imgCenterX = imgWidth / 2;
  const imgCenterY = imgHeight / 2;

  const free = items
    .filter((x) => x.cls === "free_hex")
    .map((x) => ({ x: x.x - imgCenterX, y: x.y - imgCenterY }));

  const xs = [...new Set(free.map((v) => Math.round(v.x)))].sort((a, b) => a - b);
  const xDiff = [];
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    if (d > 10) xDiff.push(d);
  }
  const STEP_X = xDiff.length ? xDiff.reduce((a, b) => a + b, 0) / xDiff.length : 1;

  const ys = [...new Set(free.map((v) => Math.round(v.y)))].sort((a, b) => a - b);
  const yDiff = [];
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i] - ys[i - 1];
    if (d > 10) yDiff.push(d);
  }
  const STEP_Y = yDiff.length ? yDiff.reduce((a, b) => a + b, 0) / yDiff.length : 1;

  for (const item of items) {
    const relX = item.x - imgCenterX;
    const relY = item.y - imgCenterY;

    const hx = Math.round(relX / STEP_X);
    const row = Math.round(relY / (STEP_Y * 2));
    let hy = row - Math.floor(hx / 2);

    const compactLayout = items.length < 25;
    if (compactLayout && Math.abs(hx) === 1) hy -= 1;

    const key = `${hx},${hy}`;
    const cell = gs.get(key);
    if (!cell) continue;

    if (!cell.active) {
      cell.active = true;
      activeCells.push(key);
    }

    if (item.cls === "free_hex") continue;

    cell.aspect = item.cls;
    cell.generated = false;
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

  if (UI.importText) UI.importText.value = JSON.stringify(state, null, 2);

  refreshUI(true);
  log("📥 исследование распознано", "success");
}

// ---------- Привязка YOLO UI (без ReferenceError, если элементов нет) ----------
function initYOLOUI() {
  UI.conf &&
    (UI.conf.oninput = (e) => {
      conf = parseFloat(e.target.value);
      if (UI.confv) UI.confv.innerText = conf;
      if (originalImg) recognizeAspects(originalImg);
    });

  UI.clearRecognitionLog &&
    (UI.clearRecognitionLog.onclick = () => {
      if (UI.log) UI.log.innerHTML = "";
    });

  UI.uploadAspects &&
    (UI.uploadAspects.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const img = new Image();
      img.onload = () => {
        originalImg = img;
        recognizeAspects(img);
      };
      img.src = URL.createObjectURL(file);
    });

  function loadTestImage(name) {
    const img = new Image();
    img.onload = () => {
      originalImg = img;
      recognizeAspects(img);
    };
    img.src = "./" + name;
  }

  $("testR3")?.addEventListener("click", () => loadTestImage("test_r3.png"));
  $("testR4")?.addEventListener("click", () => loadTestImage("test_r4.png"));
  $("testR5")?.addEventListener("click", () => loadTestImage("test_r5.png"));

  initYOLO();
}

// =========================================================
// MAIN DOMContentLoaded (разбитый на init-функции)
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
  initUIRefs();

  initCanvasAndGrid();
  initMouseControls();
  initCanvasTooltip();

  initButtons();
  initSelectUI();
  initRadiusButtons();

  // первичные логи
  log(`📚 Загружено аспектов: ${ALL_ASPECTS.length} (все аддоны).`, "success");
  log(
    `💡 Зажмите ЛКМ и водите по клеткам, чтобы включать/выключать их. ПКМ в сетке — поставить/удалить аспект. ПКМ в таблице аспектов — блокировка для автопостроения.`,
    "info"
  );

  initYOLOUI();
});
