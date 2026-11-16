'use strict';

const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const makeEditor = require('./editor');
const vehicleDetector = require('./vehicle-detector');

// This screen is an offline study; none of its data comes from a vehicle.
mgu.run({
    start: function (ctx) {
        let page = 0;
        let editor;
        const vehicle = vehicleDetector.create({ ttlMs: 60000 });
        let vehicleSub = null;
        let vehicleWatchState = 'unavailable';
        let vehicleSignalActive = false;
        let pendingVehicleEvents = [];
        const choices = [
            ['tyres', 'Шины', 'Давление и температура'],
            ['engine', 'Двигатель', 'Охлаждение и масло'],
            ['acceleration', 'Разгон 0–100', 'Источник скорости не подключён'],
            ['music', 'Сейчас играет', 'Источник музыки не подключён'],
            ['map', 'Карта CarPlay', 'Источник карты не подключён']
        ];
        const color = { bg: '#080f1b', row: '#101d30', selected: '#162b43', card: '#0c1829', white: '#e9f2ff', muted: '#9fb2c8', quiet: '#70849d', line: '#243c59', accent: '#42a5f5', blue: '#4ea5ff', crit: '#d65051', warn: '#d6a33c', cold: '#4f9bc8' };

        function acceptVehicleEvent(value, observedAt) {
            const now = Date.now();
            const result = vehicle.observe({
                provenance: { interface: vehicleDetector.VEHICLE2, member: vehicleDetector.MEMBER },
                observedAt,
                value
            }, now);
            if (result.accepted) vehicleSignalActive = true;
        }
        function watchVehicleType() {
            if (!ctx.signals || typeof ctx.signals.watch !== 'function') return;
            vehicleWatchState = 'waiting';
            try {
                Promise.resolve(ctx.signals.watch(vehicleDetector.VEHICLE2, '1', {
                    [vehicleDetector.MEMBER]: function (value) {
                        const observedAt = Date.now();
                        if (vehicleSub && vehicleSub.available === true) {
                            acceptVehicleEvent(value, observedAt);
                        } else if (!vehicleSub && vehicleWatchState === 'waiting') {
                            // signals.watch may invoke its callback before resolving its subscription.
                            pendingVehicleEvents.push({ value, observedAt });
                        }
                    }
                })).then(function (sub) {
                    vehicleSub = sub || null;
                    pendingVehicleEvents.forEach(function (event) {
                        if (vehicleSub && vehicleSub.available === true) acceptVehicleEvent(event.value, event.observedAt);
                    });
                    pendingVehicleEvents = [];
                    vehicleWatchState = vehicleSub && vehicleSub.available === true ? 'available' : 'unavailable';
                    if (vehicleWatchState !== 'available') vehicleSignalActive = false;
                }).catch(function () {
                    pendingVehicleEvents = [];
                    vehicleSub = null;
                    vehicleSignalActive = false;
                    vehicleWatchState = 'error';
                });
            } catch (error) {
                pendingVehicleEvents = [];
                vehicleWatchState = 'error';
            }
        }
        function vehicleStatus() {
            if (!vehicleSub || vehicleSub.available !== true) vehicleSignalActive = false;
            const state = vehicle.snapshot(Date.now());
            const current = !!(vehicleSignalActive && vehicleSub && vehicleSub.available === true && state.source);
            const labels = { unknown: 'неизвестно', petrol: 'бензин', diesel: 'дизель' };
            const candidate = current && state.profile !== 'unknown';
            const stale = state.expired;
            return {
                recommendationProfile: candidate ? state.profile : 'unknown',
                profile: candidate ? 'предположительно — ' + labels[state.profile] : labels.unknown,
                source: current ? 'Vehicle2.statusVehiclePartType' : 'нет достоверных данных',
                status: candidate ? 'предположительно (локальное соответствие не проверено)' : current
                    ? 'тип не распознан' : stale ? 'сигнал устарел' : vehicleWatchState === 'error'
                        ? 'ошибка источника' : vehicleWatchState === 'waiting'
                            ? 'ожидание источника' : !vehicleSub || vehicleSub.available !== true
                                ? 'источник недоступен' : 'нет достоверных данных'
            };
        }

        function fit(cv, value, x, y, size, width, opts) {
            const options = opts || {};
            let str = String(value);
            if (cv.textWidth(str, size, options) > width) {
                while (str.length && cv.textWidth(str + '...', size, options) > width) str = str.slice(0, -1);
                str = str ? str + '...' : '';
            }
            cv.text(str, x, y, size, options.color || color.white, options);
        }
        function tyre(cv, x, y, position, pressure, temp) {
            cv.roundRect(x, y, 190, 102, 4, color.card);
            cv.roundRect(x + 12, y + 12, 30, 34, 3, '#152842');
            cv.fillRect(x + 18, y + 18, 18, 3, color.line);
            cv.fillRect(x + 18, y + 26, 18, 3, color.line);
            cv.fillRect(x + 18, y + 34, 18, 3, color.line);
            cv.text(position, x + 52, y + 28, 18, color.muted, { font: 'bold' });
            cv.fillRect(x + 12, y + 55, 166, 1, color.line);
            cv.text(pressure, x + 14, y + 83, 34, color.white, { font: 'cluster-m' });
            cv.text('bar', x + 69, y + 81, 17, color.muted, { font: 'bold' });
            cv.text(temp + ' °C', x + 174, y + 81, 22, color.blue, { align: 'right', font: 'cluster-m' });
            cv.fillRect(x + 14, y + 91, 34, 3, color.blue);
        }
        function title(cv, text) {
            fit(cv, text, 1060, 162, 20, 290, { align: 'center', font: 'bold', color: color.muted });
            cv.fillRect(1032, 174, 56, 2, color.blue);
        }
        function renderWidget(cv, current) {
            if (current === 'tyres') {
                title(cv, 'ДАВЛЕНИЕ И ТЕМПЕРАТУРА');
                tyre(cv, 850, 190, 'FL', '2.4', '32');
                tyre(cv, 1080, 190, 'FR', '2.4', '33');
                tyre(cv, 850, 310, 'RL', '2.5', '31');
                tyre(cv, 1080, 310, 'RR', '2.5', '32');
            } else if (current === 'engine') {
                title(cv, 'ТЕМПЕРАТУРА ДВИГАТЕЛЯ');
                cv.fillRect(1059, 202, 2, 153, color.line);
                cv.text('ОХЛАЖДЕНИЕ', 968, 225, 19, color.muted, { align: 'center', font: 'bold' });
                cv.text('МАСЛО', 1152, 225, 19, color.muted, { align: 'center', font: 'bold' });
                cv.text('108', 986, 301, 64, color.white, { align: 'right', font: 'cluster-m' });
                cv.text('112', 1170, 301, 64, color.white, { align: 'right', font: 'cluster-m' });
                cv.text('°C', 994, 301, 22, color.blue);
                cv.text('°C', 1178, 301, 22, color.blue);
                cv.fillRect(968, 329, 36, 4, color.blue);
                cv.fillRect(1152, 329, 36, 4, color.blue);
            } else if (current === 'acceleration') {
                title(cv, 'РАЗГОН 0–100 КМ/Ч');
                cv.text('--.--', 1060, 275, 74, color.white, { align: 'center', font: 'cluster-m' });
                cv.text('СИГНАЛ СКОРОСТИ', 1060, 319, 19, color.muted, { align: 'center', font: 'bold' });
                cv.text('не подключён', 1060, 344, 20, color.muted, { align: 'center' });
            } else if (current === 'music') {
                title(cv, 'СЕЙЧАС ИГРАЕТ');
                cv.line(1025, 216, 1025, 253, 3, color.muted);
                cv.line(1025, 216, 1056, 209, 3, color.muted);
                cv.line(1056, 209, 1056, 244, 3, color.muted);
                cv.circle(1020, 253, 5, color.muted);
                cv.circle(1051, 244, 5, color.muted);
                fit(cv, 'Нет данных о треке', 1060, 296, 25, 290, { align: 'center', font: 'bold' });
                fit(cv, 'Источник не подключён', 1060, 326, 20, 290, { align: 'center', color: color.muted });
            } else if (current === 'map') {
                title(cv, 'КАРТА CARPLAY');
                cv.line(1039, 219, 1039, 268, 2, color.line);
                cv.line(1039, 219, 1061, 209, 2, color.line);
                cv.line(1061, 209, 1082, 220, 2, color.line);
                cv.line(1082, 220, 1082, 269, 2, color.line);
                cv.line(1039, 268, 1061, 258, 2, color.line);
                cv.line(1061, 258, 1082, 269, 2, color.line);
                cv.line(1061, 209, 1061, 258, 2, color.line);
                cv.text('Карта не подключена', 1060, 314, 23, color.muted, { align: 'center' });
            } else {
                title(cv, 'ЦЕНТРАЛЬНАЯ ОБЛАСТЬ');
                cv.line(1005, 258, 1115, 258, 2, color.line);
                cv.text('Без виджета', 1060, 302, 26, color.muted, { align: 'center' });
            }
        }
        function previewCanvas(cv, x, y, width, height) {
            const scale = Math.min(width / 1600, height / 520);
            const offsetX = x + (width - 1600 * scale) / 2;
            const offsetY = y + (height - 520 * scale) / 2;
            const scaled = { own: false };
            scaled.textWidth = function (text, size, opts) { return cv.textWidth(String(text), size * scale, opts) / scale; };
            scaled.target = function () {};
            ['roundRect', 'strokeRoundRect', 'fillRect', 'text', 'line', 'circle', 'arc', 'fillUnder', 'polyline'].forEach(function (method) {
                scaled[method] = function () {
                    const args = Array.prototype.slice.call(arguments);
                    if (method === 'fillUnder' || method === 'polyline') {
                        args[0] = args[0].map(function (point) {
                            return Array.isArray(point)
                                ? [offsetX + point[0] * scale, offsetY + point[1] * scale]
                                : { x: offsetX + point.x * scale, y: offsetY + point.y * scale };
                        });
                        if (method === 'fillUnder') args[1] = offsetY + args[1] * scale;
                        else args[1] *= scale;
                    } else if (method === 'arc') {
                        args[0] = offsetX + args[0] * scale; args[1] = offsetY + args[1] * scale;
                        args[2] *= scale; args[3] *= scale;
                    } else if (method === 'text') {
                        args[1] = offsetX + args[1] * scale; args[2] = offsetY + args[2] * scale; args[3] *= scale;
                    } else if (method === 'line') {
                        for (let i = 0; i < 4; i++) args[i] = (i % 2 ? offsetY : offsetX) + args[i] * scale;
                        args[4] *= scale;
                    } else if (method === 'circle') {
                        args[0] = offsetX + args[0] * scale; args[1] = offsetY + args[1] * scale; args[2] *= scale;
                    } else {
                        args[0] = offsetX + args[0] * scale; args[1] = offsetY + args[1] * scale;
                        args[2] *= scale; args[3] *= scale;
                        if (method !== 'fillRect') { args[4] *= scale; if (method === 'strokeRoundRect') args[5] *= scale; }
                    }
                    return cv[method].apply(cv, args);
                };
            });
            return scaled;
        }
        function render() {
            const t = ctx.theme(), current = ctx.settings.get('centre');
            const cv = ctx.canvas(1600, 520).clear(color.bg);
            G.frame(cv, t, ['Cluster', 'Композиция'], page, [{ text: 'DEMO' }]);
            if (page === 1) {
                editor.draw(cv);
                return ctx.ui.image('MAIN_GFX', cv);
            }
            cv.text('Центральная область', 52, 80, 34, color.white, { font: 'bold' });
            cv.text('Выберите содержимое приборки', 52, 110, 20, color.muted);
            choices.forEach(function (item, i) {
                const x = 52, y = 128 + i * 46, selected = current === item[0];
                cv.roundRect(x, y, 482, 42, 2, selected ? color.selected : color.row);
                if (selected) cv.fillRect(x, y + 4, 3, 34, color.accent);
                fit(cv, item[1], x + 18, y + 19, 21, 340, { font: 'bold' });
                fit(cv, item[2], x + 18, y + 35, 15, 350, { color: color.muted });
                if (selected) cv.text('ВЫБРАНО', x + 462, y + 28, 13, color.white, { align: 'right', font: 'bold' });
                if (cv.own) cv.target(x, y, 482, 42, function () {
                    ctx.settings.set('centre', item[0]);
                    return render();
                }, 'centre_' + item[0], 3);
            });
            cv.text(cv.own ? 'Выбор в настройках эмулятора' : 'Для выбора откройте настройки', 52, 470, 18, color.muted);
            cv.text('ПРЕДПРОСМОТР', 684, 82, 19, color.muted, { align: 'center', font: 'bold' });
            const profileStatus = vehicleStatus();
            fit(cv, 'Профиль: ' + profileStatus.profile, 1060, 125, 16, 620, { align: 'center', color: color.white });
            fit(cv, 'Источник: ' + profileStatus.source + ' · Статус: ' + profileStatus.status, 1060, 143, 13, 700, { align: 'center', color: color.muted });
            cv.line(1354, 116, 1344, 126, 3, '#6798b7');
            cv.line(1369, 116, 1359, 126, 3, '#30669a');
            cv.line(1384, 116, 1374, 126, 3, '#d65051');
            renderWidget(cv, current);
            cv.text(current === 'tyres' || current === 'engine' ? 'Демонстрационные значения. Приборка не подключена.' : 'Вывод на приборку пока не подключён.', 684, 468, 18, color.muted);
            return ctx.ui.image('MAIN_GFX', cv);
        }
        editor = makeEditor(ctx, fit, color, render, function () { return page === 1; }, function () { return vehicleStatus().recommendationProfile; });
        watchVehicleType();
        if (ctx.onTab) ctx.onTab(function (i) { if (i === 0 || i === 1) { page = i; render(); } });
        ctx.loop('MAIN', 4, render);
        render();
    }
});
