'use strict';
// Composition editor — touch-first, offline preview (redesigned).
// Long-press an empty tile to open the add-catalog; long-press a widget to edit it.
// Four corner handles resize; swipe up/down switches a widget's page; tiny ticks on the right show the page.
// Entering edit mode needs no buttons — only the right-side menu, which shifts the grid left.
const fs = require('fs'), path = require('path'), M = require('./composition'), recommendations = require('./vehicle-recommendations');
// Local rgba+withAlpha (matches kit/runtime/canvas.js so the app stays self-contained —
// the shipped app does not expose ./canvas). hex '#rrggbb'/'#rrggbbaa' or [r,g,b] → [r,g,b,a].
function rgba(c) {
    if (Array.isArray(c)) return c.length === 4 ? c.concat().slice(0,4) : [c[0], c[1], c[2], 255];
    let s = String(c).replace('#', '');
    if (s.length === 3) s = s.split('').map((x) => x + x).join('');
    const v = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16),
        s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255];
    return v;
}
function withAlpha(c, a) { const v = rgba(c); return [v[0], v[1], v[2], Math.round(a * 255)]; }

/**
 * Demo model (offline study): plausible value + range + history for every item, so the
 * widgets show a believable number that moves (like the OEM cluster does from the car's signals).
 * Ranges and values are illustrative only; they are not validated vehicle limits.
 */
const DEMO = {
    rpm: { unit: '', min: 0, max: 8000, dec: 0, base: 2400, wobble: 1600, period: 6, hlen: 60 },
    torque: { unit: 'Нм', min: 0, max: 600, dec: 0, base: 320, wobble: 180, period: 7, hlen: 60 },
    power: { unit: 'кВт', min: 0, max: 300, dec: 0, base: 150, wobble: 110, period: 7, hlen: 60 },
    boost: { unit: 'bar', min: 0, max: 3, dec: 1, base: 1.1, wobble: 0.7, period: 5, hlen: 60 },
    gear: { unit: '', min: 1, max: 8, dec: 0, base: 5, wobble: 1.5, period: 3, hlen: 40 },
    pedal: { unit: '%', min: 0, max: 100, dec: 0, base: 28, wobble: 35, period: 4, hlen: 60 },
    powerPct: { unit: '%', min: 0, max: 100, dec: 0, base: 55, wobble: 30, period: 7, hlen: 60 },
    torquePct: { unit: '%', min: 0, max: 100, dec: 0, base: 50, wobble: 28, period: 7, hlen: 60 },
    boostMax: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.6, wobble: 0.2, period: 20, hlen: 60 },
    engineState: { unit: '', min: 0, max: 2, dec: 0, base: 2, wobble: 0.2, period: 30, hlen: 20 },
    oilLevel: { unit: '%', min: 0, max: 100, dec: 0, base: 72, wobble: 2, period: 30, hlen: 60 },
    startStop: { unit: '', min: 0, max: 1, dec: 0, base: 1, wobble: 0.2, period: 20, hlen: 20 },
    coolant: { unit: '°C', min: 20, max: 120, dec: 0, base: 92, wobble: 6, period: 20, hlen: 60 },
    oil: { unit: '°C', min: 20, max: 130, dec: 0, base: 104, wobble: 6, period: 20, hlen: 60 },
    gearboxTemp: { unit: '°C', min: 20, max: 120, dec: 0, base: 78, wobble: 6, period: 20, hlen: 60 },
    outside: { unit: '°C', min: -20, max: 45, dec: 0, base: 18, wobble: 4, period: 40, hlen: 60 },
    p_fl: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.35, wobble: 0.15, period: 15, hlen: 60 },
    p_fr: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.3, wobble: 0.15, period: 15, hlen: 60 },
    p_rl: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.5, wobble: 0.15, period: 15, hlen: 60 },
    p_rr: { unit: 'bar', min: 0, max: 4, dec: 1, base: 2.45, wobble: 0.15, period: 15, hlen: 60 },
    t_fl: { unit: '°C', min: 0, max: 120, dec: 0, base: 58, wobble: 8, period: 15, hlen: 60 },
    t_fr: { unit: '°C', min: 0, max: 120, dec: 0, base: 60, wobble: 8, period: 15, hlen: 60 },
    t_rl: { unit: '°C', min: 0, max: 120, dec: 0, base: 65, wobble: 8, period: 15, hlen: 60 },
    t_rr: { unit: '°C', min: 0, max: 120, dec: 0, base: 66, wobble: 8, period: 15, hlen: 60 },
    speed: { unit: 'км/ч', min: 0, max: 240, dec: 0, base: 95, wobble: 45, period: 6, hlen: 60 },
    accel: { unit: 'с', min: 6, max: 25, dec: 0, base: 8.5, wobble: 2, period: 20, hlen: 40 },
    g_long: { unit: 'g', min: 0, max: 1.5, dec: 1, base: 0.4, wobble: 0.35, period: 4, hlen: 60 },
    g_lat: { unit: 'g', min: 0, max: 1.5, dec: 1, base: 0.3, wobble: 0.3, period: 4, hlen: 60 },
    steer: { unit: '°', min: 0, max: 400, dec: 0, base: 180, wobble: 120, period: 5, hlen: 60 },
    mode: { unit: '', min: 0, max: 2, dec: 0, base: 1, wobble: 0.2, period: 30, hlen: 20 },
    yaw: { unit: '°/с', min: 0, max: 6, dec: 1, base: 1.5, wobble: 1.5, period: 4, hlen: 60 },
    slope: { unit: '%', min: 0, max: 20, dec: 0, base: 4, wobble: 3, period: 15, hlen: 60 },
    braking: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 2, hlen: 40 },
    handbrake: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 20, hlen: 20 },
    fuel: { unit: 'л', min: 0, max: 80, dec: 0, base: 52, wobble: 1, period: 60, hlen: 60 },
    range: { unit: 'км', min: 0, max: 700, dec: 0, base: 380, wobble: 40, period: 30, hlen: 60 },
    consumption: { unit: 'л', min: 0, max: 20, dec: 1, base: 7.2, wobble: 2.5, period: 6, hlen: 60 },
    odo: { unit: 'км', min: 0, max: 200000, dec: 0, base: 42000, wobble: 200, period: 120, hlen: 60 },
    trip: { unit: 'км', min: 0, max: 200, dec: 0, base: 64, wobble: 10, period: 30, hlen: 60 },
    avgCons1: { unit: 'л', min: 0, max: 20, dec: 1, base: 7.5, wobble: 1, period: 60, hlen: 60 },
    avgSpeed1: { unit: 'км/ч', min: 0, max: 200, dec: 0, base: 82, wobble: 20, period: 40, hlen: 60 },
    tripTime: { unit: '', min: 0, max: 600, dec: 0, base: 3600, wobble: 200, period: 60, hlen: 60 },
    tripFuel: { unit: 'л', min: 0, max: 100, dec: 1, base: 18.4, wobble: 2, period: 40, hlen: 60 },
    fuelFlow: { unit: 'л/ч', min: 0, max: 40, dec: 1, base: 8.5, wobble: 3, period: 6, hlen: 60 },
    voltage: { unit: 'В', min: 0, max: 16, dec: 1, base: 14.2, wobble: 0.3, period: 10, hlen: 60 },
    battery: { unit: '%', min: 0, max: 100, dec: 0, base: 82, wobble: 6, period: 40, hlen: 60 },
    track: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 },
    artist: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 },
    map: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 },
    route: { unit: '', min: 0, max: 1, dec: 0, base: 0, wobble: 0.2, period: 30, hlen: 20 }
};
const fmt = (v, d) => (typeof v === 'number' ? v.toFixed(d || 0) : '--');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Charts show a rolling 3-minute window (not a live flicker): keep samples within the last 180s.
const HISTORY_MINUTES = 3;

// Optional sixth argument: profile string, {profile}, or a provider function returning either.
// Optional seventh argument: { now() } supplies this editor's demo clock in milliseconds.
module.exports = function (ctx, fit, color, redraw, isActive, vehicleProfile, demoOptions) {
    const demoNow = demoOptions && typeof demoOptions.now === 'function' ? demoOptions.now : Date.now;
    const demoHist = {};
    let readOnlyDraw = false;
    const file = path.join(ctx.dataDir, 'composition.json');
    let data = M.empty(), blocked = false, msg = '', edit = false, selected = -1;
    let cell = { x: 0, y: 0 }, undo = null, confirmClear = false;
    let showMenu = false, menuState = 'select', editPick = null; // select=add; edit=manage widget
    let menuPage = 0, maxMenuPage = 0;
    let resizing = false, resizeDir = '', resizeStart = {}, resizeOrig = {}, resizePreview = null;
    let gesture = null, dragTarget = null;

    // ---- Layout: equal margins on all sides; grid shrinks when the menu opens. ----
    const LEFT = 52, RIGHT = 52, TOP = 24, BOTTOM_PAD = 22;
    const ROWS = 4, COLS = 3, GAP = 8;
    // Fill the page height so widgets are as tall (readable) as possible; the chrome header is
    // drawn by the display above this surface, so no big top margin is needed here.
    const ch = Math.floor((520 - TOP - BOTTOM_PAD - GAP * (ROWS - 1)) / ROWS);
    const MW = 500, MH = 504, MY = 8;
    const GAP_BETWEEN = 32;
    const REC = { x: LEFT, y: TOP + 8, w: 1600 - RIGHT - MW - GAP_BETWEEN - LEFT, h: 96 };
    let MX = 1600 - RIGHT - MW;
    let cw = 0;
    function computeLayout() {
        const gridRight = showMenu ? MX - GAP_BETWEEN : 1600 - RIGHT;
        cw = (gridRight - LEFT - GAP * (COLS - 1)) / COLS;
    }
    function gridX(i) { return LEFT + i * (cw + GAP); }
    function gridY(j) { return TOP + j * (ch + GAP); }
    function box(w) {
        return { x: gridX(w.x), y: gridY(w.y),
                 w: w.w * cw + (w.w - 1) * GAP, h: w.h * ch + (w.h - 1) * GAP };
    }

    // ---- Catalog ----
    const groupedCategories = [
        { name: 'Основные', items: ['rpm', 'torque', 'power', 'gear', 'speed', 'accel', 'coolant', 'oil', 'tyres'], color: '#42a5f5' },
        { name: 'Температуры', items: ['outside', 'gearboxTemp'], color: '#ef5350' },
        { name: 'Движение', items: ['g_long', 'g_lat', 'steer', 'yaw', 'slope', 'braking'], color: '#66bb6a' },
        { name: 'Топливо', items: ['fuel', 'range', 'consumption', 'odo', 'trip'], color: '#ffa726' },
        { name: 'Электрика', items: ['voltage', 'battery'], color: '#ab47bc' },
        { name: 'Медиа', items: ['track', 'artist', 'map', 'route'], color: '#26c6da' }
    ];
    const addFlat = [];
    const _perWheel = /^[pt]_(fl|fr|rl|rr)$/;
    M.categories.forEach(c => c.items.forEach(i => { if (!_perWheel.test(i[0])) addFlat.push({ id: i[0], name: i[1], unit: i[2] }); }));
    const selectFlat = [];
    groupedCategories.forEach(g => g.items.forEach(id => {
        const item = M.items[id];
        if (item) selectFlat.push({ id, name: item.name, unit: item.unit, cat: g.name, color: g.color });
    }));
    const PER_PAGE = 10;

    try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); const loaded = M.migrate(raw); if (!loaded) throw Error('invalid'); data = loaded; }
    catch (e) { if (e.code !== 'ENOENT') { blocked = true; msg = 'Ошибка чтения. Сохранение недоступно'; } }
    function save(r, keepUndo) {
        if (r.error) { msg = r.error; redraw(); return false; }
        if (blocked) { msg = 'Ошибка чтения. Сохранение недоступно'; redraw(); return false; }
        try { fs.writeFileSync(file + '.tmp', JSON.stringify(r.value, null, 2), 'utf8'); fs.renameSync(file + '.tmp', file); if (!keepUndo) undo = data; data = r.value; selected = r.index; msg = 'Сохранено в DEMO'; confirmClear = false; }
        catch (e) { try { fs.unlinkSync(file + '.tmp'); } catch (_) {} msg = 'Ошибка сохранения. Изменение не применено'; redraw(); return false; }
        redraw();
        return true;
    }
    function action(a, arg) { confirmClear = false; return save(M.apply(data, a, selected, arg)); }
    const ACTIONS = { undo: { x: LEFT, y: 60, w: 132, h: 36 }, clear: { x: LEFT + 140, y: 60, w: 148, h: 36 } };
    // Keep rejection feedback on the same toolbar row, but start it after the widest control.
    const STATUS = { x: ACTIONS.clear.x + ACTIONS.clear.w + 16, y: 60, w: 650, h: 40 };
    function toolbarTargetAt(x, y) {
        for (const name of ['undo', 'clear']) {
            const r = ACTIONS[name];
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return name;
        }
        return null;
    }
    function undoLast() {
        if (!undo) { msg = 'Нет успешного изменения для отмены'; redraw(); return false; }
        const previous = undo;
        if (!save({ value: previous, index: -1 }, true)) return false;
        undo = null;
        selected = -1; confirmClear = false; msg = 'Отменено последнее изменение'; redraw();
        return true;
    }
    function activateClear() {
        if (!data.widgets.length) { confirmClear = false; msg = 'Композиция уже пуста'; redraw(); return false; }
        if (!confirmClear) { confirmClear = true; msg = 'Подтвердите очистку повторным нажатием "Очистить?"'; redraw(); return true; }
        const success = save({ value: M.empty(), index: -1 });
        if (success) { selected = -1; showMenu = false; edit = false; menuState = 'select'; editPick = null; msg = 'Композиция очищена'; computeLayout(); redraw(); }
        return success;
    }
    function removeSelectedItem() {
        if (!showMenu || menuState !== 'edit' || selected < 0 || !data.widgets[selected]) return false;
        const removedCell = { x: data.widgets[selected].x, y: data.widgets[selected].y };
        if (!action('removeItem')) return false;
        editPick = null;
        if (selected < 0) {
            cell = removedCell;
            menuState = 'select';
            menuPage = 0;
            computeLayout();
            redraw();
        }
        return true;
    }
    function deleteSelected() {
        if (!action('delete')) return false;
        selected = -1; showMenu = false; computeLayout(); redraw();
        return true;
    }

    function refreshMaxPage() { maxMenuPage = Math.max(0, Math.ceil(selectFlat.length / PER_PAGE) - 1); }
    refreshMaxPage();

    function currentProfile() {
        let value = typeof vehicleProfile === 'function' ? vehicleProfile() : vehicleProfile;
        if (value && typeof value === 'object') value = value.profile;
        return value === 'petrol' || value === 'diesel' ? value : 'unknown';
    }
    function acceptRecommendation() {
        if (data.widgets.length !== 0) return;
        const result = recommendations.recommend(data, currentProfile());
        if (result) save({ value: result, index: -1 });
    }

    // ---- Hit testing ----
    let hx = 0, hy = 0;
    function hit(cx, cy) {
        hx = cx; hy = cy;
        if (data.widgets.length === 0 && !showMenu && cx >= REC.x && cx < REC.x + REC.w && cy >= REC.y && cy < REC.y + REC.h) return { recommendation: true };
        if (showMenu && cx >= MX && cx < MX + MW && cy >= MY && cy < MY + MH) return { menu: true };
        if (edit && selected >= 0) {
            const b = box(data.widgets[selected]);
            const bx = b.x + b.w - 30, by = b.y + 6, bs = 26;
            if (cx >= bx && cx < bx + bs && cy >= by && cy < by + bs) return { delete: true, index: selected };
        }
        if (edit && selected >= 0) {
            const b = box(data.widgets[selected]);
            const dirs = ['tl', 'tr', 'bl', 'br'];
            const cs = [4, b.w - 4, 4, b.w - 4];
            const csy = [4, 4, b.h - 4, b.h - 4];
            for (let k = 0; k < 4; k++) if (Math.abs(cx - (b.x + cs[k])) < 16 && Math.abs(cy - (b.y + csy[k])) < 16) return { corner: true, dir: dirs[k], index: selected };
        }
        for (let i = data.widgets.length - 1; i >= 0; i--) {
            const b = box(data.widgets[i]);
            if (cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h) return { index: i, x: data.widgets[i].x, y: data.widgets[i].y };
        }
        if (cy >= TOP && cy < TOP + ROWS * ch + GAP * (ROWS - 1)) {
            const j = Math.min(ROWS - 1, Math.floor((cy - TOP) / (ch + GAP)));
            const i = Math.min(COLS - 1, Math.floor((cx - LEFT) / (cw + GAP)));
            if (cx >= gridX(i) && cx < gridX(i) + cw && cy >= gridY(j) && cy < gridY(j) + ch) return { x: i, y: j };
        }
        return null;
    }

    function openMenuFor(h) {
        edit = true; showMenu = true;
        if (h.index >= 0) { selected = h.index; menuState = 'edit'; editPick = null; refreshMaxPage(); }
        else { menuState = 'select'; cell = { x: h.x, y: h.y }; menuPage = 0; refreshMaxPage(); }
        redraw();
    }
    function clearMenu() { showMenu = false; menuState = 'select'; editPick = null; edit = false; }

    function selectWidget(idx) { clearMenu(); selected = idx >= 0 ? idx : -1; redraw(); }

    function onCatalogTap(item) {
        if (menuState === 'select') {
            if (action('add', { x: cell.x, y: cell.y, id: item.id })) {
                selected = data.widgets.length - 1; menuState = 'edit'; editPick = null; refreshMaxPage(); redraw();
            }
        } else {
            const w = data.widgets[selected]; if (!w) return;
            if (editPick !== 'page' && editPick !== 'together') { msg = 'Сначала выберите "Страница" или "Вместе"'; redraw(); return; }
            const operation = editPick;
            editPick = null;
            action(operation, { id: item.id });
            redraw();
        }
    }

    function startResize(h) { resizing = true; resizeDir = h.dir; resizeStart = { x: hx, y: hy };
        const w = data.widgets[h.index]; resizeOrig = { index: h.index, x: w.x, y: w.y, w: w.w, h: w.h }; resizePreview = null; }
    function calculateResize(cx, cy) {
        const dx = cx - resizeStart.x, dy = cy - resizeStart.y;
        const w = data.widgets[resizeOrig.index]; if (!w) return null;
        let newW = resizeOrig.w, newH = resizeOrig.h; const dir = resizeDir;
        if (dir.indexOf('r') >= 0) newW = Math.max(1, Math.min(COLS, resizeOrig.w + Math.round(dx / cw)));
        if (dir.indexOf('l') >= 0) newW = Math.max(1, Math.min(COLS, resizeOrig.w + Math.round(-dx / cw)));
        if (dir.indexOf('b') >= 0) newH = Math.max(1, Math.min(ROWS, resizeOrig.h + Math.round(dy / ch)));
        if (dir.indexOf('t') >= 0) newH = Math.max(1, Math.min(ROWS, resizeOrig.h + Math.round(-dy / ch)));
        const nx = dir.indexOf('l') >= 0 ? resizeOrig.x + resizeOrig.w - newW : resizeOrig.x;
        const ny = dir.indexOf('t') >= 0 ? resizeOrig.y + resizeOrig.h - newH : resizeOrig.y;
        const result = M.apply(data, 'size', resizeOrig.index, { x: nx, y: ny, w: newW, h: newH });
        if (result.error) { msg = 'Не помещается. Освободите место'; return null; }
        return { x: nx, y: ny, w: newW, h: newH };
    }
    function previewResize(cx, cy) {
        resizePreview = calculateResize(cx, cy);
        if (resizePreview) msg = '';
        redraw();
    }

    // ---- Drawing ----
    // Baseline that vertically centres a line of `s` px inside a box [y, y+h].
    function vmid(y, h, s) { return y + h / 2 + s * 0.33; }
    function drawHandles(cv, b) {
        const s = 12, t = 3, c = color.accent, inset = 5;
        const L = (px, py, sx, sy) => { cv.line(px, py, px + sx * s, py, t, c); cv.line(px, py, px, py + sy * s, t, c); };
        L(b.x + inset, b.y + inset, 1, 1);
        L(b.x + b.w - inset, b.y + inset, -1, 1);
        L(b.x + inset, b.y + b.h - inset, 1, -1);
        L(b.x + b.w - inset, b.y + b.h - inset, -1, -1);
    }
    function drawSwipeDots(cv, w) {
        const n = Math.min(6, w.pages.length), sp = 8;
        const b = box(w);
        const sx = b.x + b.w - sp - ((n - 1) * sp) / 2 - 6, sy = b.y + b.h / 2 - ((n - 1) * sp) / 2;
        for (let i = 0; i < n; i++) cv.roundRect(sx + i * sp, sy + i * sp, 6, 6, 2, i === (w.active || 0) ? color.accent : color.line);
    }
    function demoValue(id) {
        const d = DEMO[id] || DEMO.speed;
        const now = demoNow();
        const val = clamp(d.base + d.wobble * Math.sin(now / 1000 / (d.period || 5)), d.min, d.max);
        const arr = demoHist[id] || [];
        if (!readOnlyDraw) {
            arr.push([now, val]);
            const cutoff = now - HISTORY_MINUTES * 60 * 1000;
            while (arr.length && arr[0][0] < cutoff) arr.shift();
            demoHist[id] = arr;
        }
        return { d, val, vals: arr.map((h) => h[1]) };
    }
    // Values array for a history id (samples trimmed to the rolling 3-minute window).
    function histVals(id) { const arr = demoHist[id] || []; return arr.map((h) => h[1]); }
    // Shrink a value so value + unit always fit the inner width (never overlaps the unit or edge).
    function _fitValueSize(cv, value, unit, maxSize, minSize, availW) {
        const unitW = unit ? (cv.textWidth ? cv.textWidth(unit, Math.max(11, Math.round(maxSize * 0.30))) : unit.length * maxSize * 0.22) : 0;
        let size = maxSize;
        while (size > minSize) {
            const vw = cv.textWidth ? cv.textWidth(value, size, { font: 'cluster-m' }) : value.length * size * 0.62;
            if (vw + unitW + 10 <= availW) break;
            size -= 2;
        }
        return size;
    }
    // One consistent metric card: label top-left, DEMO top-right, big value with the unit on the
    // SAME baseline to its right, an optional level bar, an optional rolling sparkline and an
    // optional min/max footer. Every band follows the one above it, so nothing ever overlaps.
    function _metricCard(cv, b, o) {
        const compact = o.compact, pad = compact ? 12 : 16;
        const x = b.x, y = b.y, W = b.w, H = b.h;
        const innerL = x + pad, innerR = x + W - pad, innerW = innerR - innerL;
        const accent = o.accent || '#468bd4';
        cv.roundRect(x + 2, y + 2, W - 4, H - 4, 10, '#0e141f');
        cv.strokeRoundRect(x + 2.5, y + 2.5, W - 5, H - 5, 10, 1, '#26313e');
        cv.fillRect(innerL, y + 3, innerW, 2, accent);
        const labY = y + (compact ? 20 : 25);
        cv.text(o.label, innerL, labY, compact ? 10.5 : 12, color.muted, { font: 'bold', spacing: 1 });
        cv.text('DEMO', innerR, labY, compact ? 9 : 10, color.muted, { align: 'right', font: 'bold' });
        const maxV = compact ? 32 : Math.min(58, Math.max(38, H * 0.36));
        const minV = compact ? 18 : 24;
        const unit = o.unit || '', unitSize = compact ? 12 : 15;
        const vSize = _fitValueSize(cv, o.value, unit, maxV, minV, innerW);
        const vTop = y + (compact ? 26 : 34);
        const vBase = vTop + vSize * 0.74;
        cv.text(o.value, innerL, vBase, vSize, color.white, { font: 'cluster-m' });
        const vw = cv.textWidth ? cv.textWidth(o.value, vSize, { font: 'cluster-m' }) : o.value.length * vSize * 0.6;
        if (unit) cv.text(unit, innerL + vw + (compact ? 5 : 8), vBase, unitSize, color.muted);
        let cursor = vBase + vSize * 0.24;
        if (typeof o.frac === 'number') {
            const barH = 4, barY = cursor + (compact ? 8 : 12), barW = innerW;
            cv.roundRect(innerL, barY, barW, barH, barH / 2, '#26313e');
            const fw = Math.max(barH, barW * Math.max(0, Math.min(1, o.frac)));
            if (o.frac > 0) cv.roundRect(innerL, barY, fw, barH, barH / 2, accent);
            cursor = barY + barH;
        }
        if (o.vals && o.vals.length > 1) {
            const hasMM = !compact;
            const top = cursor + (compact ? 8 : 12);
            const bottom = y + H - (hasMM ? 24 : (compact ? 12 : 16));
            const h = bottom - top;
            if (h > 6) {
                const vals = o.vals, lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
                const span = hi - lo > 1e-6 ? hi - lo : 1, spanW = innerW, x0 = innerL;
                const pts = vals.map((v, i) => [x0 + i / (vals.length - 1) * spanW, bottom - ((v - lo) / span) * h]);
                cv.fillUnder(pts, bottom, withAlpha(accent, 0.12));
                cv.polyline(pts, 2, accent);
            }
            if (!compact) {
                const dec = o.dec || 0;
                cv.text('мин ' + fmt(Math.min.apply(null, o.vals), dec), innerL, y + H - 9, 10, color.muted);
                cv.text('макс ' + fmt(Math.max.apply(null, o.vals), dec), innerR, y + H - 9, 10, color.muted, { align: 'right' });
            }
        }
    }
    // Dynamic metrics: label, big value + unit, level bar (full cards) and a rolling sparkline.
    function drawChart(cv, b, w) {
        const activePage = w.pages[w.active || 0]; if (!activePage || !activePage.length) return;
        const id = activePage[0], item = M.items[id]; if (!item) return;
        const { d, val, vals } = demoValue(id);
        const compact = b.h < 130;
        const unit = item.unit || d.unit || '';
        const frac = d.max > d.min ? (val - d.min) / (d.max - d.min) : 0;
        _metricCard(cv, b, {
            label: itemLabel(id), value: fmt(val, d.dec), unit, dec: d.dec,
            frac, vals: compact ? null : vals, compact, accent: '#468bd4',
        });
    }

    const CHART_ITEMS = new Set(['rpm', 'torque', 'power', 'boost', 'pedal', 'powerPct', 'torquePct', 'boostMax', 'speed', 'accel', 'g_long', 'g_lat', 'steer', 'yaw', 'slope', 'fuelFlow']);
    const TEMP_ITEMS = new Set(['coolant', 'oil', 'gearboxTemp', 'outside', 't_fl', 't_fr', 't_rl', 't_rr']);
    const STATE_ITEMS = new Set(['gear', 'engineState', 'startStop', 'mode', 'braking', 'handbrake', 'track', 'artist', 'map', 'route']);
    const WHEEL_IDS = ['p_fl', 'p_fr', 'p_rl', 'p_rr'];
    const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];
    function itemLabel(id) {
        const i = M.items[id];
        if (id === 'tyres') return 'ШИНЫ';
        if (/^p_(fl|fr|rl|rr)$/.test(id)) return 'ДАВЛЕНИЕ ' + WHEEL_LABELS[WHEEL_IDS.indexOf(id)];
        if (/^t_(fl|fr|rl|rr)$/.test(id)) return 'ТЕМП. ' + id.slice(2).toUpperCase();
        return i && i.name ? i.name.toUpperCase() : 'НЕИЗВЕСТНЫЙ ПОКАЗАТЕЛЬ';
    }
    function drawDemoTag(cv, x, y, width) {
        cv.text('DEMO', x + width - 8, y + 15, 11, color.muted, { align: 'right', font: 'bold' });
    }
    function drawCard(cv, b, id, x, width, compact) {
        const item = M.items[id], known = !!(item && DEMO[id]);
        const state = STATE_ITEMS.has(id);
        const C = compact || b.h < 130;
        const pad = C ? 12 : 16;
        if (state) {
            cv.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 10, '#0e141f');
            cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 10, 1, '#26313e');
            cv.fillRect(b.x + pad, b.y + 3, b.w - 2 * pad, 2, color.accent);
            cv.text(itemLabel(id), b.x + pad, b.y + (C ? 20 : 25), C ? 10.5 : 12, color.muted, { font: 'bold', spacing: 1 });
            cv.text('DEMO', b.x + b.w - pad, b.y + (C ? 20 : 25), C ? 9 : 10, color.muted, { align: 'right', font: 'bold' });
            const stateNames = { gear: '5', engineState: 'READY', startStop: 'ON', mode: 'NORMAL', braking: 'OFF', handbrake: 'OFF', track: 'НЕТ ДАННЫХ', artist: 'НЕТ ДАННЫХ', map: 'НЕ ПОДКЛЮЧЕНА', route: 'НЕТ МАРШРУТА' };
            const txt = known ? (stateNames[id] || '—') : '—';
            const cy = b.y + b.h * 0.60;
            const pw = Math.min(b.w - 2 * pad, C ? 160 : 220), ph = C ? 26 : 34;
            cv.roundRect(b.x + (b.w - pw) / 2, cy - ph / 2, pw, ph, 8, color.selected);
            cv.text(txt, b.x + b.w / 2, cy + (C ? 6 : 8), C ? 15 : 19, color.accent, { align: 'center', font: 'bold' });
            return;
        }
        const dv = known ? demoValue(id) : null;
        const raw = dv ? dv.val : null;
        const dm = known ? DEMO[id] : null;
        const frac = (dm && raw != null && dm.max > dm.min) ? Math.max(0, Math.min(1, (raw - dm.min) / (dm.max - dm.min))) : null;
        _metricCard(cv, b, {
            label: itemLabel(id),
            value: known ? fmt(raw, dm.dec) : '--',
            unit: known ? (dm.unit || item.unit || '') : '',
            dec: known ? dm.dec : 0,
            frac, vals: null, compact: C, accent: color.accent,
        });
    }
    function drawTemperature(cv, b, id) {
        const item = M.items[id], known = !!(item && DEMO[id]);
        const d = known ? DEMO[id] : null;
        const H = b.h, W = b.w;
        const ring = known && H >= 130 && W <= H * 2.6;   // tall, not elongated -> dial; else horizontal gauge
        if (!ring) {
            const dv = known ? demoValue(id) : null;
            const val = dv ? dv.val : null;
            const pad = 12, x = b.x, y = b.y, W = b.w, H = b.h;
            cv.roundRect(x + 2, y + 2, W - 4, H - 4, 10, '#0e141f');
            cv.strokeRoundRect(x + 2.5, y + 2.5, W - 5, H - 5, 10, 1, '#26313e');
            cv.fillRect(x + pad, y + 3, W - 2 * pad, 2, color.accent);
            cv.text(itemLabel(id), x + pad, y + 20, 10.5, color.muted, { font: 'bold', spacing: 1 });
            cv.text('DEMO', x + W - pad, y + 20, 9, color.quiet || color.muted, { align: 'right', font: 'bold' });
            if (!known || val == null) { cv.text('--', x + W / 2, y + H * 0.62, 24, color.muted, { align: 'center', font: 'cluster-m' }); return; }
            // compact dial: small 270-degree ring on the left, value + unit to its right (SOC/SOH echo)
            const frac = d.max > d.min ? Math.max(0, Math.min(1, (val - d.min) / (d.max - d.min))) : 0;
            const R = Math.min(H * 0.30, 30), th = Math.max(6, R * 0.22);
            const cx = x + pad + R, cy = y + H * 0.60;
            cv.arc(cx, cy, R - th, R, -135, 135, '#26313e', { round: true });
            if (frac > 0.002) cv.arc(cx, cy, R - th, R, -135, -135 + frac * 270, color.accent, { round: true });
            const vSize = Math.min(34, Math.round(H * 0.42)), vStr = fmt(val, d.dec);
            const vx = cx + R + 12, vBase = cy + vSize * 0.30;
            cv.text(vStr, vx, vBase, vSize, color.white, { font: 'cluster-m' });
            const vw = cv.textWidth ? cv.textWidth(vStr, vSize, { font: 'cluster-m' }) : vStr.length * vSize * 0.6;
            const unit = d.unit || item.unit || '';
            if (unit) cv.text(unit, vx + vw + 6, vBase, 12, color.muted);
            return;
        }
        const pad = 16;
        cv.roundRect(b.x + 2, b.y + 2, W - 4, H - 4, 10, '#0e141f');
        cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, W - 5, H - 5, 10, 1, '#26313e');
        cv.fillRect(b.x + pad, b.y + 3, W - 2 * pad, 2, color.accent);
        cv.text(itemLabel(id), b.x + pad, b.y + 25, 12, color.muted, { font: 'bold', spacing: 1 });
        cv.text('DEMO', b.x + W - pad, b.y + 25, 10, color.muted, { align: 'right', font: 'bold' });
        const { d: dd, val } = demoValue(id);
        const frac = Math.max(0, Math.min(1, (val - dd.min) / (dd.max - dd.min)));
        // SOC/SOH style ring: 270-degree donut with round caps, value centred inside.
        const cx = b.x + W / 2, cy = b.y + H * 0.55;
        const R = Math.min(W * 0.32, H * 0.30, 96);
        const th = Math.max(9, R * 0.16);
        cv.arc(cx, cy, R - th, R, -135, 135, '#26313e', { round: true });
        if (frac > 0.002) cv.arc(cx, cy, R - th, R, -135, -135 + frac * 270, color.accent, { round: true });
        cv.text(fmt(val, dd.dec), cx, cy + R * 0.16, Math.round(R * 0.60), color.white, { align: 'center', font: 'cluster-m' });
        cv.text(dd.unit || item.unit || '', cx, cy + R * 0.62, Math.round(R * 0.17), color.muted, { align: 'center' });
        cv.text('мин ' + fmt(dd.min, dd.dec), b.x + pad, b.y + H - 9, 10, color.muted);
        cv.text('макс ' + fmt(dd.max, dd.dec), b.x + W - pad, b.y + H - 9, 10, color.muted, { align: 'right' });
    }
    function drawNumberWithUnit(cv, value, unit, centerX, y, size, valueColor, unitColor, unitSize, align) {
        const valueWidth = cv.textWidth ? cv.textWidth(value, size, { font: 'cluster-m' }) : value.length * size * 0.62;
        const unitWidth = cv.textWidth ? cv.textWidth(unit, unitSize) : unit.length * unitSize * 0.55;
        const totalWidth = valueWidth + unitWidth + 3;
        const left = align === 'right' ? centerX - totalWidth : centerX - totalWidth / 2;
        cv.text(value, left + valueWidth / 2, y, size, valueColor, { align: 'center', font: 'cluster-m' });
        cv.text(unit, left + valueWidth + 3, y, unitSize, unitColor);
    }
    function drawTyres(cv, b, compact) {
        cv.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 10, color.row);
        cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 10, 1, color.line);
        cv.fillRect(b.x + 4, b.y + 3, b.w - 8, 4, color.accent);
        cv.text('ШИНЫ', b.x + 10, b.y + 16, compact ? 11 : 13, color.muted, { font: 'bold' });
        cv.text('DEMO', b.x + b.w - 8, b.y + 16, 11, color.muted, { align: 'right', font: 'bold' });
        if (compact) {
            const colW = b.w / 4;
            WHEEL_IDS.forEach((id, i) => {
                const x = b.x + i * colW, pressure = demoValue(id).val, tempId = 't_' + id.slice(2), temperature = demoValue(tempId).val;
                cv.text(WHEEL_LABELS[i], x + colW / 2, b.y + 31, 11, color.muted, { align: 'center', font: 'bold' });
                drawNumberWithUnit(cv, fmt(pressure, DEMO[id].dec), 'бар', x + colW / 2, b.y + 47, 11, color.white, color.white, 9);
                drawNumberWithUnit(cv, fmt(temperature, DEMO[tempId].dec), '°C', x + colW / 2, b.y + 61, 11, color.muted, color.muted, 9);
            });
            return;
        }
        const top = b.y + 22, contentH = b.h - 24, gap = 5;
        const cellW = (b.w - gap * 3) / 2, cellH = (contentH - gap * 3) / 2;
        WHEEL_IDS.forEach((id, i) => {
            const x = b.x + gap + (i % 2) * (cellW + gap), y = top + gap + Math.floor(i / 2) * (cellH + gap);
            const pressure = demoValue(id).val, tempId = 't_' + id.slice(2), temperature = demoValue(tempId).val;
            cv.roundRect(x, y, cellW, cellH, 8, color.bg);
            cv.strokeRoundRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1, 8, 1, color.line);
            cv.text(WHEEL_LABELS[i], x + 8, y + 15, 12, color.muted, { font: 'bold' });
            drawNumberWithUnit(cv, fmt(pressure, DEMO[id].dec), 'бар', x + cellW / 2, y + cellH * 0.52, cellH < 60 ? 18 : 23, color.white, color.white, 10);
            drawNumberWithUnit(cv, fmt(temperature, DEMO[tempId].dec), '°C', x + cellW - 7, y + cellH - 7, 12, color.muted, color.muted, 9, 'right');
        });
    }
    function drawCompactTyrePair(cv, b, otherId) {
        // Preserve both legacy paired signals in a 1×1 widget: four concise wheel readouts
        // above a dedicated line for the companion signal rather than clipping one away.
        drawTyres(cv, b, true);
        const item = M.items[otherId], d = ['track', 'artist', 'map', 'route'].includes(otherId) ? null : DEMO[otherId];
        const name = itemLabel(otherId), unit = d ? (d.unit || item.unit || '') : (item && item.unit || '');
        const value = d ? fmt(demoValue(otherId).val, d.dec) : '--';
        const y = b.y + b.h - 5, left = b.x + 10, right = b.x + b.w - 10;
        const nameSize = 11, valueSize = 13, unitSize = 11, gap = 5;
        const nameWidth = cv.textWidth ? cv.textWidth(name, nameSize, { font: 'bold' }) : name.length * nameSize * 0.6;
        const valueWidth = cv.textWidth ? cv.textWidth(value, valueSize, { font: 'cluster-m' }) : value.length * valueSize * 0.62;
        const unitWidth = unit ? (cv.textWidth ? cv.textWidth(unit, unitSize) : unit.length * unitSize * 0.55) : 0;
        const unitGap = unit ? 4 : 0;
        // Keep the companion on a dedicated footer row; place the value/unit group at
        // the right edge so even longer labels cannot collide with it or the tyre row.
        cv.text(name, left, y, nameSize, color.muted, { font: 'bold' });
        const groupWidth = valueWidth + unitGap + unitWidth;
        const groupLeft = Math.max(left + nameWidth + gap, right - groupWidth);
        cv.text(value, groupLeft + valueWidth / 2, y, valueSize, color.white, { align: 'center', font: 'cluster-m' });
        if (unit) cv.text(unit, groupLeft + valueWidth + unitGap, y, unitSize, color.white);
    }
    function drawSemantic(cv, b, w) {
        const page = w.pages && w.pages[w.active || 0];
        if (!page || !page.length) return;
        const tyreIndex = page.indexOf('tyres');
        if (tyreIndex >= 0 && page.length === 1) { drawTyres(cv, b, b.h < 125); return; }
        if (tyreIndex >= 0 && page.length === 2 && b.h < 125) {
            drawCompactTyrePair(cv, b, page[1 - tyreIndex]);
            return;
        }
        const cols = page.length, subW = b.w / cols;
        page.forEach((id, i) => {
            const part = { x: b.x + i * subW, y: b.y, w: subW, h: b.h };
            if (id === 'tyres') drawTyres(cv, part, part.h < 125);
            else if (TEMP_ITEMS.has(id)) drawTemperature(cv, part, id);
            else if (CHART_ITEMS.has(id) && M.items[id] && DEMO[id]) drawChart(cv, part, { ...w, pages: [[id]], active: 0, w: w.w / cols, h: w.h });
            else drawCard(cv, part, id, part.x, subW, b.w < 520 || b.h < 140);
        });
    }

    // ---- Touch ----
    function touch(phase, tx, ty) {
        if (!isActive() && !showMenu) return false;
        if (phase === 1) {
            if (resizing) return true;
            const h = hit(tx, ty);
            if (h && h.menu) {
                gesture = { menu: true, menuTarget: menuTargetAt(tx, ty), moved: false, ox: tx, oy: ty, timer: null };
                return true;
            }
            if (h && h.delete) { gesture = { deleteTarget: true, moved: false, ox: tx, oy: ty, timer: null }; return true; }
            if (h && h.corner) { startResize(h); return true; }
            const mode = h && h.index >= 0 ? 'move' : 'add';
            gesture = { h, moved: false, mode, ox: tx, oy: ty, timer: null };
            if (h && h.index >= 0) cell = { x: h.x, y: h.y };
            if (!edit && h) gesture.timer = setTimeout(function () { if (gesture && !gesture.moved) { gesture.longPressed = true; openMenuFor(h); } }, 600);
            else if (edit) gesture.timer = setTimeout(function () { if (gesture && !gesture.moved) gesture.mode = 'move'; }, 400);
            return true;
        }
        if (phase === 2) {
            if (resizing) { previewResize(tx, ty); return true; }
            if (!gesture) return false;
            const dx = tx - gesture.ox, dy = ty - gesture.oy;
            if (!gesture.moved && (Math.abs(dx) > 18 || Math.abs(dy) > 18)) { gesture.moved = true; clearTimeout(gesture.timer); }
            if (gesture.deleteTarget) {
                const deleteHit = hit(tx, ty);
                if (!deleteHit || !deleteHit.delete || deleteHit.index !== selected) gesture.moved = true;
            }
            if (gesture.menu && gesture.menuTarget !== menuTargetAt(tx, ty)) gesture.menuLeftTarget = true;
            if (edit && gesture.moved && gesture.mode === 'move' && gesture.h && gesture.h.index >= 0) {
                const w = data.widgets[gesture.h.index];
                const dx = tx - gesture.ox, dy = ty - gesture.oy;
                const x = w.x + Math.round(dx / (cw + GAP)), y = w.y + Math.round(dy / (ch + GAP));
                dragTarget = { x, y, valid: M.fits(data.widgets, x, y, w.w, w.h, gesture.h.index) };
                msg = dragTarget.valid ? 'Перетащите виджет в свободную ячейку' : 'Не помещается. Освободите место';
                redraw();
            }
            return true;
        }
        if (phase === 3) {
            if (gesture) clearTimeout(gesture.timer);
            if (resizing) {
                const candidate = calculateResize(tx, ty);
                if (candidate && (candidate.x !== resizeOrig.x || candidate.y !== resizeOrig.y || candidate.w !== resizeOrig.w || candidate.h !== resizeOrig.h)) {
                    selected = resizeOrig.index;
                    save(M.apply(data, 'size', resizeOrig.index, candidate));
                }
                resizing = false; resizePreview = null; redraw(); return true;
            }
            if (gesture && gesture.h && gesture.h.recommendation) {
                const released = hit(tx, ty);
                const valid = !gesture.moved && released && released.recommendation;
                gesture = null;
                if (valid) acceptRecommendation();
                return true;
            }
            if (gesture && gesture.menu) {
                const target = gesture.menuTarget;
                const moved = gesture.moved, leftTarget = gesture.menuLeftTarget;
                const released = menuTargetAt(tx, ty);
                gesture = null;
                if (!leftTarget && !moved && target && target === released) {
                    hit(tx, ty);
                    handleMenuTap({ menu: true });
                }
                return true;
            }
            if (gesture && gesture.deleteTarget) {
                const released = hit(tx, ty);
                const valid = !gesture.moved && released && released.delete && released.index === selected;
                gesture = null;
                if (valid) deleteSelected();
                return true;
            }
            if (gesture && gesture.longPressed) { gesture = null; return true; }
            if (gesture && gesture.h) {
                if (edit) {
                    if (gesture.moved && gesture.mode === 'move' && gesture.h.index >= 0) {
                        const target = dragTarget;
                        if (target) {
                            const result = M.apply(data, 'move', gesture.h.index, { x: target.x, y: target.y });
                            if (result.error) { msg = 'Перемещение отклонено: ячейка занята или вне сетки'; redraw(); }
                            else save(result);
                        } else redraw();
                    } else selectWidget(gesture.h.index >= 0 ? gesture.h.index : -1);
                } else if (gesture.moved && gesture.h.index >= 0 && Math.abs(ty - gesture.oy) > 40 && Math.abs(ty - gesture.oy) > Math.abs(tx - gesture.ox)) {
                    selected = gesture.h.index; action('next', { delta: ty < gesture.oy ? 1 : -1 });
                }
            }
            gesture = null; dragTarget = null; return true;
        }
        if (phase === 4) {
            if (gesture) clearTimeout(gesture.timer);
            if (gesture && gesture.toolbarAction === 'clear' && confirmClear) { confirmClear = false; msg = 'Очистка отменена'; }
            if (gesture && gesture.moved) msg = 'Перетаскивание отменено';
            gesture = null; dragTarget = null; resizing = false; resizePreview = null; redraw(); return true;
        }
        return true;
    }
    const oldTouch = ctx.display._touch;
    ctx.display._touch = function (phase, x, y) { if (touch(phase, x, y)) return; return oldTouch.call(this, phase, x, y); };

    // ---- Menu tap handling (own path uses cv.target per element) ----
    function catalogPageSize() { return menuState === 'edit' && selected >= 0 ? 4 : 8; }
    function catTopOf() { return MY + (menuState === 'edit' && selected >= 0 ? 250 : 90); }
    function catalogCard(i) { const cardW = (MW - 36) / 2, cardH = 54, gapX = 10, gapY = 8; return { x: MX + 12 + (i % 2) * (cardW + gapX), y: catTopOf() + Math.floor(i / 2) * (cardH + gapY), w: cardW, h: cardH }; }
    function pageControl(direction) { return { x: MX + 12 + (direction === 'prev' ? 0 : MW - 24 - 104), y: MY + MH - 48, w: 104, h: 34 }; }
    // Give every actionable menu region a stable identity. A menu action is committed only
    // when a gesture starts and ends on this exact target; the menu's empty background is inert.
    function menuTargetAt(x, y) {
        const cbx = MX + MW - 40, cby = MY + 8, cbs = 34;
        if (x >= cbx && x < cbx + cbs && y >= cby && y < cby + cbs) return 'close';
        if (menuState === 'edit' && selected >= 0) {
            const w = data.widgets[selected];
            if (!w) return null;
            let cx = MX + 12;
            for (let i = 0; i < w.pages.length; i++, cx += 80) {
                if (x >= cx && x < cx + 72 && y >= MY + 80 && y < MY + 110) return 'page:' + i;
            }
            const bw = (MW - 24) / 2;
            if (x >= MX + 12 && x < MX + 12 + bw - 4 && y >= MY + 116 && y < MY + 152) return 'control:page';
            if (x >= MX + 12 + bw && x < MX + 12 + bw + bw - 4 && y >= MY + 116 && y < MY + 152) return 'control:together';
            if (x >= MX + 12 && x < MX + 12 + bw - 4 && y >= MY + 158 && y < MY + 194) return 'control:order';
            if (x >= MX + 12 + bw && x < MX + 12 + bw + bw - 4 && y >= MY + 158 && y < MY + 194) return 'control:removeItem';
            if (x >= MX + 12 && x < MX + MW - 12 && y >= MY + 200 && y < MY + 236) return 'delete';
        }
        const list = menuState === 'select' ? selectFlat : addFlat;
        const pages = Math.max(1, Math.ceil(list.length / catalogPageSize()));
        for (const direction of ['prev', 'next']) { const r = pageControl(direction); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && (direction === 'prev' ? menuPage > 0 : menuPage < pages - 1)) return direction === 'prev' ? 'page-up' : 'page-down'; }
        for (let i = 0; i < catalogPageSize(); i++) {
            const idx = menuPage * catalogPageSize() + i;
            if (idx >= list.length) break;
            const rect = catalogCard(i);
            if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return 'catalog:' + idx;
        }
        return null;
    }
    function handleMenuTap(h) {
        const x = hx, y = hy;
        const cbx = MX + MW - 40, cby = MY + 8, cbs = 34;
        if (x >= cbx && x < cbx + cbs && y >= cby && y < cby + cbs) { const hadWidget = menuState === 'edit'; clearMenu(); edit = true; if (!hadWidget) selected = -1; msg = hadWidget ? 'Редактирование: перетащите виджет или удерживайте для меню' : 'Редактирование сетки'; computeLayout(); redraw(); return; }
        if (menuState === 'edit' && selected >= 0) {
            const w = data.widgets[selected];
            const chipW = 72, chipH = 30; let cx = MX + 12;
            w.pages.forEach((pg, i) => {
                if (x >= cx && x < cx + chipW && y >= MY + 80 && y < MY + 110) { if (i !== w.active) action('next', { delta: i - w.active }); return; }
                cx += chipW + 8;
            });
            const ctl = [['Страница', 'page'], ['Вместе', 'together'], ['Порядок', 'order'], ['- Пункт', 'removeItem']];
            const bw = (MW - 24) / 2;
            for (let k = 0; k < ctl.length; k++) {
                const bnd = ctl[k];
                const bx = MX + 12 + (k % 2) * bw;
                const by = MY + 116 + Math.floor(k / 2) * 42;
                if (x >= bx && x < bx + bw - 4 && y >= by && y < by + 36) {
                    if (bnd[1] === 'order') { editPick = null; action(bnd[1]); }
                    else if (bnd[1] === 'removeItem') removeSelectedItem();
                    else { editPick = editPick === bnd[1] ? null : bnd[1]; msg = editPick ? 'Выберите показатель в каталоге' : ''; redraw(); }
                    return;
                }
            }
            const delY = MY + 200;
            if (x >= MX + 12 && x < MX + MW - 12 && y >= delY && y < delY + 36) { deleteSelected(); return; }
        }
        // catalog grid
        const cols = 2;
        const list = menuState === 'select' ? selectFlat : addFlat;
        const pages = Math.max(1, Math.ceil(list.length / catalogPageSize()));
        for (const direction of ['prev', 'next']) { const r = pageControl(direction); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && (direction === 'prev' ? menuPage > 0 : menuPage < pages - 1)) { menuPage += direction === 'prev' ? -1 : 1; redraw(); return; } }
        for (let i = 0; i < catalogPageSize(); i++) {
            const idx = menuPage * catalogPageSize() + i; if (idx >= list.length) break;
            const item = list[idx];
            const rect = catalogCard(i);
            if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) { onCatalogTap(item); return; }
        }
    }

    // ---- Draw ----
    function draw(cv, options) {
        const interactive = !options || options.interactive !== false;
        const readOnly = !!(options && options.readOnly === true);
        readOnlyDraw = readOnly;
        computeLayout();
        const catTop = catTopOf();
        const cols = 2;
        const list = menuState === 'select' ? selectFlat : addFlat;
        const pages = Math.max(1, Math.ceil(list.length / catalogPageSize()));

        // grid cells: only while editing (a guide). In view mode the widgets stand on the dark
        // background with no empty-cell frames, so a sparse composition still looks finished.
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
            if (!edit) continue;
            const sel = selected < 0 && cell.x === i && cell.y === j;
            cv.roundRect(gridX(i), gridY(j), cw, ch, 8, sel ? color.selected : color.row);
            cv.strokeRoundRect(gridX(i) + 1, gridY(j) + 1, cw - 2, ch - 2, 8, sel ? 2.5 : 1.5, sel ? color.accent : color.line);
        }
        if (!readOnly && edit && selected < 0) {
            const b = box({ x: cell.x, y: cell.y, w: 1, h: 1 });
            cv.strokeRoundRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, 8, 2, color.accent);
        }
        if (!readOnly && data.widgets.length === 0 && !showMenu) {
            const profile = currentProfile();
            const label = profile === 'unknown' ? 'Автоподбор · профиль неизвестен' : 'Автоподбор · предположительно ' + (profile === 'diesel' ? 'дизель' : 'бензин');
            cv.roundRect(REC.x, REC.y, REC.w, REC.h, 9, color.selected);
            cv.strokeRoundRect(REC.x + 0.5, REC.y + 0.5, REC.w - 1, REC.h - 1, 9, 1, color.accent);
            fit(cv, label + ' · DEMO', REC.x + 18, REC.y + 34, 16, REC.w - 36, { color: color.white, font: 'bold' });
            fit(cv, 'Нажмите и отпустите, чтобы принять рекомендацию', REC.x + 18, REC.y + 60, 13, REC.w - 36, { color: color.muted });
        }

        // widgets
        const renderedWidgets = data.widgets.slice();
        if (resizePreview && renderedWidgets[resizeOrig.index]) renderedWidgets[resizeOrig.index] = { ...renderedWidgets[resizeOrig.index], ...resizePreview };
        renderedWidgets.forEach((w, idx) => {
            const b = box(w); const isSelected = !readOnly && idx === selected;
            cv.roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 10, isSelected ? color.selected : color.row);
            if (isSelected) cv.strokeRoundRect(b.x + 2.5, b.y + 2.5, b.w - 5, b.h - 5, 10, 2, color.accent);
            if (w.pages && w.pages.length > 0) drawSemantic(cv, b, w);
            if (w.pages && w.pages.length > 1) drawSwipeDots(cv, w);
            if (edit && isSelected) drawHandles(cv, b);
        });
        if (!readOnly && dragTarget && selected >= 0 && data.widgets[selected]) {
            const w = data.widgets[selected], targetBox = box({ x: dragTarget.x, y: dragTarget.y, w: w.w, h: w.h });
            cv.strokeRoundRect(targetBox.x + 1.5, targetBox.y + 1.5, targetBox.w - 3, targetBox.h - 3, 8, 3, dragTarget.valid ? color.accent : color.crit);
        }

        // delete button (top-right of selected widget)
        if (!readOnly && edit && selected >= 0) {
            const b = box(data.widgets[selected]);
            const bx = b.x + b.w - 30, by = b.y + 6, bs = 26;
            cv.roundRect(bx, by, bs, bs, 6, '#d32f2f');
            cv.line(bx + 9, by + 9, bx + bs - 9, by + bs - 9, 2.5, color.white);
            cv.line(bx + bs - 9, by + 9, bx + 9, by + bs - 9, 2.5, color.white);
            if (cv.own && interactive) cv.target(bx, by, bs, bs, deleteSelected, 'del_btn', 3);
        }

        // menu
        if (!readOnly && showMenu) {
            cv.roundRect(MX, MY, MW, MH, 16, color.bg);
            cv.strokeRoundRect(MX + 0.5, MY + 0.5, MW - 1, MH - 1, 16, 1.5, color.line);
            cv.roundRect(MX, MY, MW, 52, 16, color.row);
            cv.line(MX, MY + 52, MX + MW, MY + 52, 1, color.line);
            fit(cv, menuState === 'select' ? 'Добавить показатель' : 'Управление виджетом', MX + MW / 2, vmid(MY, 52, 20), 20, MW - 100, { align: 'center', font: 'bold', color: color.white });
            const _sub = menuState === 'select'
                ? 'Выберите карточку — добавим в пустую ячейку'
                : (editPick ? 'Режим: ' + (editPick === 'page' ? 'новый лист' : editPick === 'together' ? 'на текущий лист' : '') + ' — выберите показатель' : 'Свайп по «Стр.» — листы. Сначала действие, затем показатель');
            fit(cv, _sub, MX + 16, MY + 56, 13, MW - 32, { color: editPick ? color.accent : color.muted });
            const cbx = MX + MW - 40, cby = MY + 8, cbs = 34;
            cv.roundRect(cbx, cby, cbs, cbs, 8, color.selected);
            cv.line(cbx + 10, cby + 10, cbx + cbs - 10, cby + cbs - 10, 2.5, color.white);
            cv.line(cbx + cbs - 10, cby + 10, cbx + 10, cby + cbs - 10, 2.5, color.white);
            if (cv.own && interactive) cv.target(cbx, cby, cbs, cbs, function () { clearMenu(); }, 'menu_close', 3);

            if (menuState === 'edit' && selected >= 0) {
                const w = data.widgets[selected];
                const chipW = 72, chipH = 30; let cx = MX + 12;
                w.pages.forEach((pg, i) => {
                    const py = MY + 80, isSel = i === (w.active || 0);
                    cv.roundRect(cx, py, chipW, chipH, 7, isSel ? color.accent : color.selected);
                    fit(cv, 'Стр.' + (i + 1), cx + chipW / 2, vmid(py, 30, 13), 13, chipW - 8, { align: 'center', font: 'bold', color: isSel ? color.bg : color.white });
                    const _cnt = Math.min(5, (pg && pg.length) || 0);
                    for (let d = 0; d < _cnt; d++) { const dx = cx + chipW / 2 - (_cnt - 1) * 4 + d * 8; cv.roundRect(dx - 2, py + chipH - 8, 4, 4, 2, isSel ? color.bg : color.accent); }
                    if (cv.own && interactive) cv.target(cx, py, chipW, chipH, (function (ii) { return function () { const current = data.widgets[selected]; if (current && ii !== current.active) action('next', { delta: ii - current.active }); }; })(i), 'pchip_' + i, 2);
                    cx += chipW + 8;
                });
                const ctl = [['Страница', 'page'], ['Вместе', 'together'], ['Порядок', 'order'], ['- Пункт', 'removeItem']];
                const bw = (MW - 24) / 2;
                ctl.forEach((bnd, k) => {
                    const bx = MX + 12 + (k % 2) * bw;
                    const by = MY + 116 + Math.floor(k / 2) * 42;
                    cv.roundRect(bx, by, bw - 4, 36, 7, editPick === bnd[1] ? color.accent : color.selected);
                    const ic = editPick === bnd[1] ? color.bg : color.white;
                    // small drawn icon (crisp at any size): page(+), together(two squares), order(lines), remove(minus)
                    const ix = bx + 18, iy = by + 18;
                    if (bnd[1] === 'page') {
                        cv.strokeRoundRect(ix - 6, iy - 7, 12, 14, 2, 1.5, ic);
                        cv.line(ix, iy - 1, ix, iy + 5, 1.5, ic); cv.line(ix - 3, iy + 2, ix + 3, iy + 2, 1.5, ic);
                    } else if (bnd[1] === 'together') {
                        cv.strokeRoundRect(ix - 7, iy - 6, 9, 11, 2, 1.5, ic);
                        cv.strokeRoundRect(ix - 2, iy - 3, 9, 11, 2, 1.5, ic);
                    } else if (bnd[1] === 'order') {
                        cv.line(ix - 6, iy - 4, ix + 6, iy - 4, 1.5, ic); cv.line(ix - 6, iy + 4, ix + 6, iy + 4, 1.5, ic);
                        cv.line(ix - 3, iy - 7, ix - 3, iy - 1, 1.5, ic); cv.line(ix + 3, iy + 1, ix + 3, iy + 7, 1.5, ic);
                    } else {
                        cv.line(ix - 6, iy, ix + 6, iy, 2, ic);
                    }
                    fit(cv, bnd[0], bx + (bw - 4) / 2 + 6, vmid(by, 36, 12), 12, bw - 20, { align: 'center', font: 'bold', color: editPick === bnd[1] ? color.bg : color.white });
                    if (cv.own && interactive) cv.target(bx, by, bw - 4, 36, (function (knd) {
                        return function () {
                            if (knd === 'order') { editPick = null; action(knd); }
                            else if (knd === 'removeItem') removeSelectedItem();
                            else { editPick = editPick === knd ? null : knd; msg = editPick ? 'Выберите показатель в каталоге' : ''; redraw(); }
                        };
                    })(bnd[1]), 'ctl_' + bnd[1], 2);
                    });
                const delY = MY + 200;
                cv.roundRect(MX + 12, delY, MW - 24, 36, 7, '#d32f2f');
                fit(cv, 'Удалить виджет', MX + MW / 2, vmid(delY, 36, 13), 13, MW - 40, { align: 'center', font: 'bold', color: color.white });
                if (cv.own && interactive) cv.target(MX + 12, delY, MW - 24, 36, deleteSelected, 'menu_del', 3);
            }
            cv.text('ПОКАЗАТЕЛИ', MX + 16, catTopOf() - 6, 10, color.muted, { font: 'bold' });
            for (let i = 0; i < catalogPageSize(); i++) {
                const idx = menuPage * catalogPageSize() + i; if (idx >= list.length) break;
                const item = list[idx];
                const card = catalogCard(i); const px = card.x, py = card.y, pillW = card.w, pillH = card.h;
                const cat = menuState === 'select' ? groupedCategories.find(g => g.items.indexOf(item.id) >= 0) : null;
                cv.roundRect(px, py, pillW, pillH, 9, color.selected);
                if (cat) cv.fillRect(px + 5, py + 6, 4, pillH - 12, cat.color);
                fit(cv, item.name, px + 18, py + 22, 15, pillW - 30, { font: 'bold' });
                if (item.unit) fit(cv, item.unit, px + 18, py + 40, 12, pillW - 30, { color: color.muted });
                if (cv.own && interactive) cv.target(px, py, pillW, pillH, (function (it) { return function () { onCatalogTap(it); }; })(item), 'cat_' + menuState + '_' + idx, 2);
            }
            const prev = pageControl('prev'), next = pageControl('next');
            const pmy = prev.y + prev.h / 2, nmy = next.y + next.h / 2;
            cv.roundRect(prev.x, prev.y, prev.w, prev.h, 8, menuPage > 0 ? color.selected : color.row);
            const pc = menuPage > 0 ? color.white : color.muted;
            cv.line(prev.x + 23, pmy - 6, prev.x + 17, pmy, 2.5, pc); cv.line(prev.x + 17, pmy, prev.x + 23, pmy + 6, 2.5, pc);
            cv.text('Назад', prev.x + 34, pmy + 5, 13, pc, { font: 'bold' });
            if (cv.own && interactive && menuPage > 0) cv.target(prev.x, prev.y, prev.w, prev.h, function () { menuPage = Math.max(0, menuPage - 1); redraw(); }, 'pg_up', 3);
            fit(cv, (menuPage + 1) + ' / ' + pages, MX + MW / 2, prev.y + 10, 14, 88, { align:'center', font:'bold', color:color.white });
            cv.roundRect(next.x, next.y, next.w, next.h, 8, menuPage < pages - 1 ? color.selected : color.row);
            const nc = menuPage < pages - 1 ? color.white : color.muted;
            cv.text('Далее', next.x + next.w - 34, nmy + 5, 13, nc, { font: 'bold', align: 'right' });
            cv.line(next.x + next.w - 23, nmy - 6, next.x + next.w - 17, nmy, 2.5, nc); cv.line(next.x + next.w - 17, nmy, next.x + next.w - 23, nmy + 6, 2.5, nc);
            if (cv.own && interactive && menuPage < pages - 1) cv.target(next.x, next.y, next.w, next.h, function () { menuPage = Math.min(pages - 1, menuPage + 1); redraw(); }, 'pg_dn', 3);
            // contextual help fills the free band above pagination (add and edit menus)
            const helpY = prev.y - 60;
            cv.text('Подсказка', MX + 16, helpY, 11, color.muted, { font: 'bold' });
            fit(cv, 'Удержание по виджету открывает это меню. Плитка каталога добавляет показатель.', MX + 16, helpY + 16, 11, MW - 30, { color: color.muted });
            fit(cv, 'Стр. N — переключить лист. «- Пункт» убирает последний показатель.', MX + 16, helpY + 32, 11, MW - 30, { color: color.muted });
        }

        // Single status line at the very bottom (rejections in red). No persistent toolbar/help clutter.
        if (!readOnly && msg) {
            const isRejection = msg.indexOf('Не помещается') === 0 || msg.indexOf('Перемещение отклонено') === 0 || msg.indexOf('Шинам нужна область') === 0;
            const fy = 514;
            if (isRejection) {
                const w = Math.min(900, String(msg).length * 8 + 28);
                cv.roundRect(LEFT, fy - 16, w, 22, 6, '#d65051');
                fit(cv, msg, LEFT + 12, fy, 12, w - 24, { color: color.white, font: 'bold' });
            } else {
                fit(cv, msg, LEFT, fy, 12, 900, { color: color.muted });
            }
        }
    }
    return { draw: draw };
};
