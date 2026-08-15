const data = window.TokyoJrData;
document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="./operator-icons.css"/>');
document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="./route-signs.css"/>');
document.head.insertAdjacentHTML('beforeend', '<style>.map-stage svg{position:absolute;left:-320px;top:-320px;width:calc(100% + 640px);height:calc(100% + 640px)}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>#map-layer{position:absolute;left:-320px;top:-320px;width:calc(100% + 640px);height:calc(100% + 640px);contain:paint;will-change:transform;transform:translate3d(0,0,0)}#map-bitmap{position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;will-change:transform;transform:translate3d(0,0,0)}#map-layer svg{position:static;display:block;width:100%;height:100%;min-height:0;will-change:auto}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>.data-label{pointer-events:auto;cursor:pointer}.data-label:hover{fill:#ef774c;font-weight:800}.info-line{display:grid;grid-template-columns:15px 17px 1fr;gap:6px;align-items:center;width:100%;padding:5px 7px;border:0;border-radius:4px;background:#e7f1ed;color:#33755f;font:10px \'Noto Sans JP\',sans-serif;cursor:pointer}.info-line input{accent-color:#17322d}.info-line:hover{filter:brightness(.95)}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>.connection-mark{display:none}.data-station.interchange:not(.seibu):not(.metro) circle{fill:#ef774c;stroke:#fff;stroke-width:1.5}.data-station.interchange.seibu circle{fill:#f4bd20;stroke:#fff;stroke-width:1.5}.data-station.interchange.metro circle{fill:#667783;stroke:#fff;stroke-width:1.5}</style>');
document.querySelector('[data-layer="connections"]')?.closest('label')?.remove();
document.querySelector('.legend.civic')?.parentElement?.remove();
const stage = document.querySelector('#stage'); const map = document.querySelector('#map'); const mapLayer = document.createElement('div'); mapLayer.id = 'map-layer'; map.before(mapLayer); mapLayer.append(map); const mapBitmap = document.createElement('canvas'); mapBitmap.id = 'map-bitmap'; mapLayer.before(mapBitmap); const info = document.querySelector('#info');
const search = document.querySelector('#search'); const routeList = document.querySelector('#route-list'); const filterPanel = document.querySelector('.filter-panel'); const zoomStatus = document.querySelector('#zoom-status');
const MAP_WIDTH = 1200, MAP_HEIGHT = 760, PAN_OVERSCAN = 320, PAN_REBASE_DISTANCE = PAN_OVERSCAN - 96, PAN_VISIBLE_EDGE = 2, limits = { min: .8, max: 5 };
const stationGroups = groupStations(data.stations);
const stationById = new Map(stationGroups.map(station => [station.id, station]));
const selectedLines = new Set(Object.keys(data.lines)); const view = { scale: 1, centerX: MAP_WIDTH / 2, centerY: MAP_HEIGHT / 2 }; let selectedStationId = null;
const pointers = new Map(); let dragStart = null, pinchStart = null, didDrag = false, handledTapAt = -Infinity, wheelRenderTimer = 0, wheelPreview = null, mapBitmapTimer = 0, mapBitmapVersion = 0, mapBitmapReady = false, bitmapView = null;

function esc(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
function groupStations(records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.name.trim();
    const group = groups.get(key) ?? { id: `station-group-${encodeURIComponent(key)}`, name: record.name, longitude: 0, latitude: 0, lines: new Set(), operators: new Set(), members: [] };
    group.longitude += record.longitude;
    group.latitude += record.latitude;
    record.lines.forEach(line => group.lines.add(line));
    record.operators?.forEach(operator => group.operators.add(operator));
    group.members.push(record.id);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    ...group,
    longitude: group.longitude / group.members.length,
    latitude: group.latitude / group.members.length,
    lines: [...group.lines],
    operators: [...group.operators]
  }));
}
function isSeibu(station) { return station.operators?.some(operator => operator.includes('西武')); }
function isSeibuLine(line) { return data.lineOperators?.[line]?.some(operator => operator.includes('西武')) ?? false; }
function isMetro(station) { return station.operators?.some(operator => operator.includes('東京地下鉄')); }
function isMetroLine(line) { return data.lineOperators?.[line]?.some(operator => operator.includes('東京地下鉄')) ?? false; }
function operatorKey(operator = '') { return operator.includes('西武') ? 'seibu' : operator.includes('東京地下鉄') || operator.includes('東京メトロ') ? 'metro' : 'jr'; }
function operatorName(operator = '') { return operatorKey(operator) === 'seibu' ? '西武鉄道' : operatorKey(operator) === 'metro' ? '東京メトロ' : 'JR東日本'; }
function operatorIcon(operator, withName = false) {
  const key = operatorKey(operator), mark = key === 'seibu' ? '西' : key === 'metro' ? 'M' : 'JR';
  return `<span class="operator-identity ${key}"><span class="operator-icon ${key}" aria-hidden="true">${mark}</span>${withName ? `<span>${operatorName(operator)}</span>` : ''}</span>`;
}
function stationOperatorIcons(station) { return [...new Set(station.operators ?? [])].map(operator => operatorIcon(operator)).join(''); }
const LINE_CODES = { '山手線':'JY', '中央線':'JC', '総武線':'JB', '東海道線':'JT', '京葉線':'JE', '常磐線':'JJ', '青梅線':'JC', '南武線':'JN', '東北線':'JU', '池袋線':'SI', '新宿線':'SS', '拝島線':'SS', '多摩湖線':'ST', '国分寺線':'SK', '多摩川線':'SW', '西武有楽町線':'SI', '豊島線':'SI', '西武園線':'SS', '山口線':'SY', '2号線日比谷線':'H', '3号線銀座線':'G', '4号線丸ノ内線':'M', '4号線丸ノ内線分岐線':'Mb', '5号線東西線':'T', '7号線南北線':'N', '8号線有楽町線':'Y', '9号線千代田線':'C', '11号線半蔵門線':'Z', '13号線副都心線':'F' };
function routeSign(line, compact = false) { return `<span class="route-sign${compact ? ' compact' : ''}" style="--route-color:${lineColor(line)}" title="${esc(line)}" aria-label="${esc(line)}">${LINE_CODES[line] ?? 'JR'}</span>`; }
function lineColor(line) { const colors = { '池袋線':'#e85f25','新宿線':'#48a757','拝島線':'#e0a91c','多摩湖線':'#d65087','国分寺線':'#6c9dce','多摩川線':'#d78352','西武有楽町線':'#8b6dc3','豊島線':'#c96c9f','西武園線':'#c37234','山口線':'#ec7b4e','山手線':'#8ebe4a','中央線':'#fa9438','総武線':'#e6c62d','東海道線':'#24a5bf','京葉線':'#bc3b70','常磐線':'#4aa797','2号線日比谷線':'#b5b5b5','3号線銀座線':'#f4a832','4号線丸ノ内線':'#dc3b49','4号線丸ノ内線分岐線':'#dc3b49','5号線東西線':'#47a8bb','7号線南北線':'#00ac9b','8号線有楽町線':'#c1a470','9号線千代田線':'#00bb85','11号線半蔵門線':'#8f76d6','13号線副都心線':'#9c5f3e' }; return colors[line] ?? (isSeibuLine(line) ? '#f4bd20' : isMetroLine(line) ? '#6f7f89' : '#397ac6'); }
function geoProjector() { const stations = stationGroups; const minLng = Math.min(...stations.map(s => s.longitude)) - .025, maxLng = Math.max(...stations.map(s => s.longitude)) + .025, minLat = Math.min(...stations.map(s => s.latitude)) - .02, maxLat = Math.max(...stations.map(s => s.latitude)) + .02; return ([lng, lat]) => [((lng - minLng) / (maxLng - minLng)) * MAP_WIDTH, MAP_HEIGHT - ((lat - minLat) / (maxLat - minLat)) * MAP_HEIGHT]; }
const project = geoProjector();
function pathFor(geometry) { const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates]; return lines.map(line => line.map((point, index) => { const [x, y] = project(point); return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ')).join(' '); }
function polygonPath(geometry) { const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]; return polygons.flatMap(polygon => polygon).map(ring => ring.map((point, index) => { const [x, y] = project(point); return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ') + 'Z').join(' '); }
function visibleStations() { const term = search.value.trim().toLocaleLowerCase('ja'); return stationGroups.filter(station => station.lines.some(line => selectedLines.has(line)) && (!term || station.name.toLocaleLowerCase('ja').includes(term) || station.lines.some(line => line.toLocaleLowerCase('ja').includes(term)))); }
function focusLines(lines) { selectedLines.clear(); lines.forEach(line => selectedLines.add(line)); renderRoutes(); render(); refreshSelectedStationCard(); }
function showStation(station) { const interchange = station.lines.length > 1; info.querySelector('.card-type').innerHTML = `${stationOperatorIcons(station)}<span>${interchange ? '乗換駅' : operatorName(station.operators?.[0])}</span>`; info.querySelector('h2').textContent = station.name; info.querySelector('p').textContent = `${station.operators?.join('・') ?? ''} / この駅に接続する路線をハイライトしています。`; info.querySelector('.card-tags').innerHTML = station.lines.map(line => `<button class="info-line" data-focus-line="${esc(line)}" style="--tag-color:${lineColor(line)}">${esc(line)}</button>`).join(''); info.querySelectorAll('[data-focus-line]').forEach(button => button.addEventListener('click', () => focusLines([button.dataset.focusLine]))); info.classList.remove('hidden'); }
function selectStation(station) { selectedStationId = station.id; showStation(station); render(); }
function labelLayout(stations) { const fontSize = Math.max(4.8, 8.4 / Math.sqrt(view.scale)); const accepted = []; const boxes = []; const ordered = [...stations].sort((a, b) => Number(b.id === selectedStationId) - Number(a.id === selectedStationId) || b.lines.length - a.lines.length || a.name.localeCompare(b.name, 'ja')); for (const station of ordered) { const [x, y] = project([station.longitude, station.latitude]); const width = station.name.length * fontSize * 1.12; const box = { left: x + fontSize, right: x + fontSize + width, top: y - fontSize * 1.6, bottom: y + fontSize * .35 }; const collides = boxes.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top); if (station.id === selectedStationId || !collides) { accepted.push({ station, x, y, fontSize }); boxes.push(box); } } return accepted; }
function render() {
  const stations = visibleStations();
  const selectedStation = stationById.get(selectedStationId) ?? null;
  const boundaryPaths = (data.boundaries ?? []).map(boundary => `<path class="municipal-boundary" d="${polygonPath(boundary.geometry)}"><title>${esc(boundary.name)}</title></path>`).join('');
  const railPaths = (data.railways ?? []).filter(railway => selectedLines.has(railway.line)).map(railway => `<path class="rail-geometry${isSeibuLine(railway.line) ? ' seibu-geometry' : ''}${selectedStation ? (selectedStation.lines.includes(railway.line) ? ' is-highlighted' : ' is-dimmed') : ''}" data-map-line="${esc(railway.line)}" style="--line-color:${lineColor(railway.line)}" d="${pathFor(railway.geometry)}"/>`).join('');
  const marks = stations.filter(station => station.lines.length > 1).map(station => { const [x, y] = project([station.longitude, station.latitude]); return `<circle class="connection-mark" cx="${x}" cy="${y}" r="9"/>`; }).join('');
  const dots = stations.map(station => { const [x, y] = project([station.longitude, station.latitude]); const radius = (station.lines.length > 1 ? 6 : 4) / Math.sqrt(view.scale); return `<g class="data-station${station.lines.length > 1 ? ' interchange' : ''}${isSeibu(station) ? ' seibu' : ''}${isMetro(station) ? ' metro' : ''}${station.id === selectedStationId ? ' is-selected' : ''}" data-station-id="${station.id}"><circle cx="${x}" cy="${y}" r="${station.id === selectedStationId ? radius * 1.65 : radius}"/><title>${esc(station.name)} — ${esc(station.lines.join('・'))}</title></g>`; }).join('');
  const labels = labelLayout(stations).map(({ station, x, y, fontSize }) => `<text class="data-label${isSeibu(station) ? ' seibu-label' : ''}${isMetro(station) ? ' metro-label' : ''}${station.id === selectedStationId ? ' is-selected-label' : ''}" data-station-id="${station.id}" x="${x + fontSize}" y="${y - fontSize}" font-size="${fontSize}" role="button" tabindex="0">${esc(station.name)}</text>`).join('');
  map.innerHTML = `<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#f3f5f0"/><g id="boundaries">${boundaryPaths}</g><g id="rail-lines">${railPaths}</g><g id="connections">${marks}</g><g id="rail">${dots}</g><g id="labels">${labels}</g>`;
  document.querySelectorAll('[data-layer]').forEach(input => { const target = document.querySelector(`#${input.dataset.layer}`); if (target) target.classList.toggle('hidden', !input.checked); });
  queueMapBitmap();
}
function mapStylesForBitmap() {
  return '.municipal-boundary{fill:#e6ede7;stroke:#b9c8bd;stroke-width:1.4}.rail-geometry{fill:none;stroke:var(--line-color);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;opacity:.86}.rail-geometry.seibu-geometry{stroke-width:4}.rail-geometry.is-dimmed{opacity:.13}.rail-geometry.is-highlighted{stroke-width:7;opacity:1}.data-station circle{fill:#ef774c;stroke:#fff;stroke-width:1.5}.data-station.seibu circle{fill:#f4bd20}.data-station.metro circle{fill:#667783}.data-station.interchange circle{fill:#17322d;stroke:#f8c154;stroke-width:2}.data-station.is-selected circle{stroke:#17322d;stroke-width:3}.data-label{font-family:"Noto Sans JP",sans-serif;fill:#254039;paint-order:stroke;stroke:#f3f5f0;stroke-width:3px;stroke-linejoin:round}.seibu-label{fill:#6d5512}.metro-label{fill:#405260}.is-selected-label{font-weight:800;fill:#17322d}.hidden{display:none!important}';
}
async function buildMapBitmap() {
  const version = mapBitmapVersion, width = mapLayer.clientWidth, height = mapLayer.clientHeight;
  if (!width || !height) return;
  applyView();
  const sourceView = { ...view };
  const clone = map.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = mapStylesForBitmap();
  clone.prepend(style);
  const markup = clone.outerHTML;
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (version !== mapBitmapVersion) return;
    // Keep the interactive texture deliberately small.
    const ratio = 1;
    mapBitmap.width = Math.round(width * ratio);
    mapBitmap.height = Math.round(height * ratio);
    const context = mapBitmap.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    bitmapView = sourceView;
    mapBitmapReady = true;
    mapBitmap.style.display = 'block';
    map.style.opacity = '0';
    updateBitmapTransform();
  } catch { mapBitmapReady = false; }
  finally { URL.revokeObjectURL(url); }
}
function queueMapBitmap() {
  mapBitmapVersion++;
  clearTimeout(mapBitmapTimer);
  mapBitmapTimer = setTimeout(buildMapBitmap, 120);
}
function renderRoutes() {
  const groups = [['JR東日本', Object.keys(data.lines).filter(line => !isSeibuLine(line) && !isMetroLine(line))], ['西武鉄道', Object.keys(data.lines).filter(isSeibuLine)], ['東京メトロ', Object.keys(data.lines).filter(isMetroLine)]];
  const allLines = Object.keys(data.lines); const rootState = selectedLines.size === allLines.length ? 'checked' : selectedLines.size ? 'data-indeterminate="true"' : '';
  routeList.innerHTML = `<label class="route-root"><input type="checkbox" data-all-lines ${rootState}/><span>すべての路線</span><b>${selectedLines.size}/${allLines.length}</b></label>${groups.map(([operator, lines]) => { const selectedCount = lines.filter(line => selectedLines.has(line)).length; const state = selectedCount === lines.length ? 'checked' : selectedCount ? 'data-indeterminate="true"' : ''; return `<details class="route-group" open><summary><label class="route-parent" onclick="event.stopPropagation()"><input type="checkbox" data-operator="${operator}" ${state}/>${operatorIcon(operator, true)}<b>${selectedCount}/${lines.length}</b></label></summary><div class="route-children">${lines.map(line => `<label class="route-check"><input type="checkbox" data-line="${esc(line)}" ${selectedLines.has(line) ? 'checked' : ''}/>${routeSign(line)}<span>${esc(line.replace(/^\d+号線/, ''))}</span><b>${data.lines[line].length}</b></label>`).join('')}</div></details>`; }).join('')}`;
  document.querySelectorAll('[data-indeterminate]').forEach(input => { input.indeterminate = true; });
  document.querySelector('[data-all-lines]').addEventListener('change', event => { selectedLines.clear(); if (event.target.checked) allLines.forEach(line => selectedLines.add(line)); renderRoutes(); render(); refreshSelectedStationCard(); });
  document.querySelectorAll('[data-operator]').forEach(input => input.addEventListener('change', () => { const lines = groups.find(([operator]) => operator === input.dataset.operator)[1]; lines.forEach(line => input.checked ? selectedLines.add(line) : selectedLines.delete(line)); renderRoutes(); render(); refreshSelectedStationCard(); }));
  document.querySelectorAll('[data-line]').forEach(input => input.addEventListener('change', () => { input.checked ? selectedLines.add(input.dataset.line) : selectedLines.delete(input.dataset.line); renderRoutes(); render(); refreshSelectedStationCard(); }));
}
function showStation(station) {
  const interchange = station.lines.length > 1;
  info.querySelector('.card-type').innerHTML = `${stationOperatorIcons(station)}<span>${interchange ? '乗換駅' : operatorName(station.operators?.[0])}</span>`;
  info.querySelector('h2').textContent = station.name;
  info.querySelector('p').textContent = `${station.operators?.join('・') ?? ''} / 利用路線の表示・非表示を切り替えられます。`;
  info.querySelector('.card-tags').innerHTML = station.lines.map(line => `<label class="info-line"><input type="checkbox" data-station-line="${esc(line)}" ${selectedLines.has(line) ? 'checked' : ''}/>${routeSign(line)}<span>${esc(line)}</span></label>`).join('');
  info.querySelectorAll('[data-station-line]').forEach(input => input.addEventListener('change', () => {
    input.checked ? selectedLines.add(input.dataset.stationLine) : selectedLines.delete(input.dataset.stationLine);
    renderRoutes(); render(); refreshSelectedStationCard();
  }));
  info.classList.remove('hidden');
}
function refreshSelectedStationCard() { const station = stationById.get(selectedStationId); if (station && !info.classList.contains('hidden')) showStation(station); }
function clearStationSelection() {
  if (!selectedStationId) return;
  selectedStationId = null;
  info.classList.add('hidden');
  render();
}
function selectStation(station) {
  if (!station) return;
  if (selectedStationId === station.id) {
    clearStationSelection();
    return;
  }
  selectedStationId = station.id;
  showStation(station);
  render();
}
function viewBox() { const width = MAP_WIDTH / view.scale, height = MAP_HEIGHT / view.scale; return { width, height, x: view.centerX - width / 2, y: view.centerY - height / 2 }; }
function clampView() {
  const box = viewBox();
  // Keep a thin slice of Tokyo in view, while allowing the viewport to extend beyond every edge.
  view.centerX = Math.max(-box.width / 2 + PAN_VISIBLE_EDGE, Math.min(MAP_WIDTH + box.width / 2 - PAN_VISIBLE_EDGE, view.centerX));
  view.centerY = Math.max(-box.height / 2 + PAN_VISIBLE_EDGE, Math.min(MAP_HEIGHT + box.height / 2 - PAN_VISIBLE_EDGE, view.centerY));
}
function applyView() {
  clampView();
  const box = viewBox(), rect = stage.getBoundingClientRect();
  const extraX = PAN_OVERSCAN * box.width / Math.max(1, rect.width), extraY = PAN_OVERSCAN * box.height / Math.max(1, rect.height);
  map.setAttribute('viewBox', `${box.x - extraX} ${box.y - extraY} ${box.width + extraX * 2} ${box.height + extraY * 2}`);
  zoomStatus.textContent = `${Math.round(view.scale * 100)}%`;
}
function updateBitmapTransform() {
  if (!mapBitmapReady || !bitmapView) return;
  const rect = stage.getBoundingClientRect();
  const scale = view.scale / bitmapView.scale;
  const originX = PAN_OVERSCAN + rect.width / 2, originY = PAN_OVERSCAN + rect.height / 2;
  const tx = originX * (1 - scale) + (bitmapView.centerX - view.centerX) * view.scale * rect.width / MAP_WIDTH;
  const ty = originY * (1 - scale) + (bitmapView.centerY - view.centerY) * view.scale * rect.height / MAP_HEIGHT;
  mapBitmap.style.transformOrigin = '0 0';
  mapBitmap.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale3d(${scale}, ${scale}, 1)`;
}
function previewDrag(clientX, clientY) {
  if (!dragStart) return;
  const dx = clientX - dragStart.x, dy = clientY - dragStart.y;
  view.centerX = dragStart.centerX - dx * dragStart.box.width / dragStart.rect.width;
  view.centerY = dragStart.centerY - dy * dragStart.box.height / dragStart.rect.height;
  clampView();
  if (mapBitmapReady) {
    updateBitmapTransform();
    return;
  }
  // Moving the already-painted SVG is a compositor operation. Rebuilding its viewBox
  // for every pointer sample forces the browser to repaint every path and label.
  const renderedDx = -(view.centerX - dragStart.centerX) * dragStart.rect.width / dragStart.box.width;
  const renderedDy = -(view.centerY - dragStart.centerY) * dragStart.rect.height / dragStart.box.height;
  mapLayer.style.transform = `translate3d(${renderedDx}px, ${renderedDy}px, 0)`;
  // Recenter before the composited overscan is exhausted. This keeps already
  // painted map content visible while avoiding a viewBox repaint per input event.
  if (Math.abs(renderedDx) >= PAN_REBASE_DISTANCE || Math.abs(renderedDy) >= PAN_REBASE_DISTANCE) {
    applyView();
    mapLayer.style.transform = '';
    beginDrag(clientX, clientY);
  }
}
function beginDrag(clientX, clientY) { dragStart = { x: clientX, y: clientY, centerX: view.centerX, centerY: view.centerY, box: viewBox(), rect: stage.getBoundingClientRect() }; }
function commitDrag(clientX, clientY) {
  if (!dragStart) return;
  previewDrag(clientX, clientY);
  applyView();
  mapLayer.style.transform = '';
  queueMapBitmap();
}
function zoomAt(nextScale, clientX = stage.getBoundingClientRect().left + stage.clientWidth / 2, clientY = stage.getBoundingClientRect().top + stage.clientHeight / 2, shouldRender = true, shouldApplyView = true) { const oldBox = viewBox(), rect = stage.getBoundingClientRect(), fx = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height, focusX = oldBox.x + oldBox.width * fx, focusY = oldBox.y + oldBox.height * fy; view.scale = Math.max(limits.min, Math.min(limits.max, nextScale)); const nextBox = viewBox(); view.centerX = focusX + nextBox.width / 2 - nextBox.width * fx; view.centerY = focusY + nextBox.height / 2 - nextBox.height * fy; if (shouldApplyView) applyView(); if (shouldRender) render(); }
function scheduleZoomRender() { clearTimeout(wheelRenderTimer); wheelRenderTimer = setTimeout(() => { wheelRenderTimer = 0; render(); }, 100); }
function commitWheelZoom() {
  if (!wheelPreview) return;
  clearTimeout(wheelRenderTimer);
  wheelRenderTimer = 0;
  wheelPreview = null;
  applyView();
  render();
}
function queueWheelZoom(factor, clientX, clientY) {
  wheelPreview = true;
  zoomAt(view.scale * factor, clientX, clientY, false, false);
  updateBitmapTransform();
  clearTimeout(wheelRenderTimer);
  wheelRenderTimer = setTimeout(commitWheelZoom, 80);
}
function resetView() { view.scale = 1; view.centerX = MAP_WIDTH / 2; view.centerY = MAP_HEIGHT / 2; applyView(); queueMapBitmap(); }
function pinchData(pair) { const [a, b] = pair; return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

if (!data?.stations?.length || !data?.railways?.length) throw new Error('地図データを読み込めませんでした。');
document.querySelector('#source-label').textContent = `— ${stationGroups.length}駅・${Object.keys(data.lines).length}路線 / ${new Date(data.generatedAt).toLocaleDateString('ja-JP')} 更新 —`;
info.querySelector('h2').textContent = `${stationGroups.length}駅を表示中`;
renderRoutes(); render(); applyView();
search.addEventListener('input', render); document.querySelector('#clear').addEventListener('click', () => { search.value = ''; selectedLines.clear(); Object.keys(data.lines).forEach(line => selectedLines.add(line)); renderRoutes(); render(); }); document.querySelectorAll('[data-layer]').forEach(input => input.addEventListener('change', render));
document.querySelector('#zoom-in').addEventListener('click', () => { commitWheelZoom(); zoomAt(view.scale * 1.25); }); document.querySelector('#zoom-out').addEventListener('click', () => { commitWheelZoom(); zoomAt(view.scale / 1.25); }); document.querySelector('#reset-view').addEventListener('click', () => { commitWheelZoom(); resetView(); }); document.querySelector('#close-card').addEventListener('click', clearStationSelection);
// Keep map gestures inside the map. The filter panel lives in the stage so its
// pointer and wheel events would otherwise bubble to the map handlers.
[info, routeList, search, filterPanel].forEach(element => element.addEventListener('pointerdown', event => event.stopPropagation()));
filterPanel.addEventListener('wheel', event => event.stopPropagation());
mapLayer.addEventListener('wheel', event => { event.preventDefault(); event.stopImmediatePropagation(); queueWheelZoom(event.deltaY < 0 ? 1.12 : .89, event.clientX, event.clientY); }, { capture: true, passive: false });
mapLayer.addEventListener('pointerdown', commitWheelZoom, { capture: true });
mapLayer.addEventListener('selectstart', event => event.preventDefault()); mapLayer.addEventListener('wheel', event => { event.preventDefault(); zoomAt(view.scale * (event.deltaY < 0 ? 1.12 : .89), event.clientX, event.clientY); }, { passive: false }); mapLayer.addEventListener('dblclick', event => { event.preventDefault(); zoomAt(view.scale * 1.5, event.clientX, event.clientY); });
mapLayer.addEventListener('pointerdown', event => { didDrag = false; mapLayer.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const pair = [...pointers.values()]; if (pair.length === 1) beginDrag(event.clientX, event.clientY); if (pair.length === 2) { commitDrag(pair[0].x, pair[0].y); pinchStart = { ...pinchData(pair), scale: view.scale }; } });
function movePointer(event) {
  const coalesced = event.type === 'pointermove' ? event.getCoalescedEvents?.() : null;
  const point = coalesced?.[coalesced.length - 1] ?? event;
  if (!pointers.has(point.pointerId)) return;
  pointers.set(point.pointerId, { x: point.clientX, y: point.clientY });
  const pair = [...pointers.values()];
  if (pair.length === 2 && pinchStart) {
    didDrag = true;
    const pinch = pinchData(pair);
    zoomAt(pinchStart.scale * pinch.distance / pinchStart.distance, pinch.x, pinch.y, false, false);
    updateBitmapTransform();
    scheduleZoomRender();
  } else if (pair.length === 1 && dragStart) {
    const dx = point.clientX - dragStart.x, dy = point.clientY - dragStart.y;
    if (Math.hypot(dx, dy) > 4) didDrag = true;
    previewDrag(point.clientX, point.clientY);
  }
}
// Apply the composited transform as soon as the input sample arrives. Browsers
// that expose raw samples avoid the frame of latency added by pointermove.
mapLayer.addEventListener('pointermove', movePointer, { passive: true });
if ('onpointerrawupdate' in window) mapLayer.addEventListener('pointerrawupdate', movePointer, { passive: true });
function activateMapTarget(target) { const stationNode = target?.closest?.('[data-station-id]'); if (stationNode) { const station = stationById.get(stationNode.dataset.stationId); if (station) { selectStation(station); return true; } } const lineNode = target?.closest?.('[data-map-line]'); if (lineNode) { focusLines([lineNode.dataset.mapLine]); return true; } return false; }
function endPointer(event) {
  const isTap = event.button === 0 && !didDrag && pointers.size === 1;
  const isDrag = didDrag && pointers.size === 1;
  const target = isTap ? document.elementFromPoint(event.clientX, event.clientY) : null;
  if (isDrag) commitDrag(event.clientX, event.clientY);
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (!pointers.size) {
    dragStart = null;
    if (!isDrag && dragBitmapActive) {
      map.style.visibility = '';
      mapBitmap.style.display = 'none';
      dragBitmapActive = false;
    }
  }
  if (isTap) {
    handledTapAt = performance.now();
    activateMapTarget(target);
  }
}
mapLayer.addEventListener('pointerup', endPointer); mapLayer.addEventListener('pointercancel', endPointer);
mapLayer.addEventListener('click', event => {
  if (didDrag) return;
  if (performance.now() - handledTapAt < 500) return;
  activateMapTarget(event.target);
});
stage.addEventListener('keydown', event => { const shift = 48 / view.scale; if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(view.scale * 1.2); } else if (event.key === '-') { event.preventDefault(); zoomAt(view.scale / 1.2); } else if (event.key === '0') { event.preventDefault(); resetView(); } else if ({ArrowLeft:1,ArrowRight:1,ArrowUp:1,ArrowDown:1}[event.key]) { event.preventDefault(); view.centerX += event.key === 'ArrowLeft' ? -shift : event.key === 'ArrowRight' ? shift : 0; view.centerY += event.key === 'ArrowUp' ? -shift : event.key === 'ArrowDown' ? shift : 0; applyView(); } });
