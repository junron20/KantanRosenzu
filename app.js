const data = window.TokyoJrData;
document.head.insertAdjacentHTML('beforeend', '<style>.data-label{pointer-events:auto;cursor:pointer}.data-label:hover{fill:#ef774c;font-weight:800}.info-line{display:grid;grid-template-columns:15px 17px 1fr;gap:6px;align-items:center;width:100%;padding:5px 7px;border:0;border-radius:4px;background:#e7f1ed;color:#33755f;font:10px \'Noto Sans JP\',sans-serif;cursor:pointer}.info-line input{accent-color:#17322d}.info-line:hover{filter:brightness(.95)}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>.connection-mark{display:none}.data-station.interchange:not(.seibu):not(.metro) circle{fill:#ef774c;stroke:#fff;stroke-width:1.5}.data-station.interchange.seibu circle{fill:#f4bd20;stroke:#fff;stroke-width:1.5}.data-station.interchange.metro circle{fill:#667783;stroke:#fff;stroke-width:1.5}</style>');
document.querySelector('[data-layer="connections"]')?.closest('label')?.remove();
document.querySelector('.legend.civic')?.parentElement?.remove();
const stage = document.querySelector('#stage'); const map = document.querySelector('#map'); const info = document.querySelector('#info');
const search = document.querySelector('#search'); const routeList = document.querySelector('#route-list'); const stationList = document.querySelector('#station-list'); const zoomStatus = document.querySelector('#zoom-status');
const MAP_WIDTH = 1200, MAP_HEIGHT = 760, limits = { min: .8, max: 5 };
const stationGroups = groupStations(data.stations);
const stationById = new Map(stationGroups.map(station => [station.id, station]));
const selectedLines = new Set(Object.keys(data.lines)); const view = { scale: 1, centerX: MAP_WIDTH / 2, centerY: MAP_HEIGHT / 2 }; let selectedStationId = null;
const pointers = new Map(); let dragStart = null, pinchStart = null, didDrag = false, handledTapAt = -Infinity;

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
function lineColor(line) { const colors = { '池袋線':'#e85f25','新宿線':'#48a757','拝島線':'#e0a91c','多摩湖線':'#d65087','国分寺線':'#6c9dce','多摩川線':'#d78352','西武有楽町線':'#8b6dc3','豊島線':'#c96c9f','西武園線':'#c37234','山口線':'#ec7b4e','山手線':'#8ebe4a','中央線':'#fa9438','総武線':'#e6c62d','東海道線':'#24a5bf','京葉線':'#bc3b70','常磐線':'#4aa797','2号線日比谷線':'#b5b5b5','3号線銀座線':'#f4a832','4号線丸ノ内線':'#dc3b49','4号線丸ノ内線分岐線':'#dc3b49','5号線東西線':'#47a8bb','7号線南北線':'#00ac9b','8号線有楽町線':'#c1a470','9号線千代田線':'#00bb85','11号線半蔵門線':'#8f76d6','13号線副都心線':'#9c5f3e' }; return colors[line] ?? (isSeibuLine(line) ? '#f4bd20' : isMetroLine(line) ? '#6f7f89' : '#397ac6'); }
function geoProjector() { const stations = stationGroups; const minLng = Math.min(...stations.map(s => s.longitude)) - .025, maxLng = Math.max(...stations.map(s => s.longitude)) + .025, minLat = Math.min(...stations.map(s => s.latitude)) - .02, maxLat = Math.max(...stations.map(s => s.latitude)) + .02; return ([lng, lat]) => [((lng - minLng) / (maxLng - minLng)) * MAP_WIDTH, MAP_HEIGHT - ((lat - minLat) / (maxLat - minLat)) * MAP_HEIGHT]; }
const project = geoProjector();
function pathFor(geometry) { const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates]; return lines.map(line => line.map((point, index) => { const [x, y] = project(point); return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ')).join(' '); }
function polygonPath(geometry) { const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]; return polygons.flatMap(polygon => polygon).map(ring => ring.map((point, index) => { const [x, y] = project(point); return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ') + 'Z').join(' '); }
function visibleStations() { const term = search.value.trim().toLocaleLowerCase('ja'); return stationGroups.filter(station => station.lines.some(line => selectedLines.has(line)) && (!term || station.name.toLocaleLowerCase('ja').includes(term) || station.lines.some(line => line.toLocaleLowerCase('ja').includes(term)))); }
function focusLines(lines) { selectedLines.clear(); lines.forEach(line => selectedLines.add(line)); renderRoutes(); render(); refreshSelectedStationCard(); }
function showStation(station) { const interchange = station.lines.length > 1; info.querySelector('.card-type').textContent = interchange ? '乗換駅' : (isSeibu(station) ? '西武鉄道' : isMetro(station) ? '東京メトロ' : 'JR東日本'); info.querySelector('h2').textContent = station.name; info.querySelector('p').textContent = `${station.operators?.join('・') ?? ''} / この駅に接続する路線をハイライトしています。`; info.querySelector('.card-tags').innerHTML = station.lines.map(line => `<button class="info-line" data-focus-line="${esc(line)}" style="--tag-color:${lineColor(line)}">${esc(line)}</button>`).join(''); info.querySelectorAll('[data-focus-line]').forEach(button => button.addEventListener('click', () => focusLines([button.dataset.focusLine]))); info.classList.remove('hidden'); }
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
  map.innerHTML = `<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#f3f5f0"/><g id="boundaries">${boundaryPaths}</g><g id="rail-lines">${railPaths}</g><g id="connections">${marks}</g><g id="rail">${dots}</g><g id="labels">${labels}</g><text x="36" y="44" class="map-title">東京・JR東日本 / 西武鉄道　駅マップ</text>`;
  document.querySelector('#result-count').textContent = `${stations.length} / ${stationGroups.length} 駅`;
  stationList.innerHTML = stations.map(station => `<button class="station-row${station.id === selectedStationId ? ' selected' : ''}" data-station-id="${station.id}"><strong>${esc(station.name)}</strong><span>${esc(station.lines.filter(line => selectedLines.has(line)).join('・'))}</span></button>`).join('') || '<p class="no-result">該当する駅はありません。</p>';
  stationList.querySelectorAll('[data-station-id]').forEach(node => node.addEventListener('click', () => selectStation(stationById.get(node.dataset.stationId))));
  document.querySelectorAll('[data-layer]').forEach(input => { const target = document.querySelector(`#${input.dataset.layer}`); if (target) target.classList.toggle('hidden', !input.checked); });
}
function renderRoutes() {
  const groups = [['JR東日本', Object.keys(data.lines).filter(line => !isSeibuLine(line) && !isMetroLine(line))], ['西武鉄道', Object.keys(data.lines).filter(isSeibuLine)], ['東京メトロ', Object.keys(data.lines).filter(isMetroLine)]];
  const allLines = Object.keys(data.lines); const rootState = selectedLines.size === allLines.length ? 'checked' : selectedLines.size ? 'data-indeterminate="true"' : '';
  routeList.innerHTML = `<label class="route-root"><input type="checkbox" data-all-lines ${rootState}/><span>すべての路線</span><b>${selectedLines.size}/${allLines.length}</b></label>${groups.map(([operator, lines]) => { const selectedCount = lines.filter(line => selectedLines.has(line)).length; const state = selectedCount === lines.length ? 'checked' : selectedCount ? 'data-indeterminate="true"' : ''; return `<details class="route-group" open><summary><label class="route-parent" onclick="event.stopPropagation()"><input type="checkbox" data-operator="${operator}" ${state}/><span>${operator}</span><b>${selectedCount}/${lines.length}</b></label></summary><div class="route-children">${lines.map(line => `<label class="route-check"><input type="checkbox" data-line="${esc(line)}" ${selectedLines.has(line) ? 'checked' : ''}/><span class="route-line" style="background:${lineColor(line)}"></span><span>${esc(line.replace(/^\d+号線/, ''))}</span><b>${data.lines[line].length}</b></label>`).join('')}</div></details>`; }).join('')}`;
  document.querySelectorAll('[data-indeterminate]').forEach(input => { input.indeterminate = true; });
  document.querySelector('[data-all-lines]').addEventListener('change', event => { selectedLines.clear(); if (event.target.checked) allLines.forEach(line => selectedLines.add(line)); renderRoutes(); render(); refreshSelectedStationCard(); });
  document.querySelectorAll('[data-operator]').forEach(input => input.addEventListener('change', () => { const lines = groups.find(([operator]) => operator === input.dataset.operator)[1]; lines.forEach(line => input.checked ? selectedLines.add(line) : selectedLines.delete(line)); renderRoutes(); render(); refreshSelectedStationCard(); }));
  document.querySelectorAll('[data-line]').forEach(input => input.addEventListener('change', () => { input.checked ? selectedLines.add(input.dataset.line) : selectedLines.delete(input.dataset.line); renderRoutes(); render(); refreshSelectedStationCard(); }));
}
function showStation(station) {
  const interchange = station.lines.length > 1;
  info.querySelector('.card-type').textContent = interchange ? '乗換駅' : (isSeibu(station) ? '西武鉄道' : isMetro(station) ? '東京メトロ' : 'JR東日本');
  info.querySelector('h2').textContent = station.name;
  info.querySelector('p').textContent = `${station.operators?.join('・') ?? ''} / 利用路線の表示・非表示を切り替えられます。`;
  info.querySelector('.card-tags').innerHTML = station.lines.map(line => `<label class="info-line"><input type="checkbox" data-station-line="${esc(line)}" ${selectedLines.has(line) ? 'checked' : ''}/><span class="route-line" style="background:${lineColor(line)}"></span><span>${esc(line)}</span></label>`).join('');
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
function clampView() { const box = viewBox(); view.centerX = Math.max(box.width / 2, Math.min(MAP_WIDTH - box.width / 2, view.centerX)); view.centerY = Math.max(box.height / 2, Math.min(MAP_HEIGHT - box.height / 2, view.centerY)); }
function applyView() { clampView(); const box = viewBox(); map.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`); zoomStatus.textContent = `${Math.round(view.scale * 100)}%`; }
function updateDrag(clientX, clientY) {
  if (!dragStart) return;
  const rect = stage.getBoundingClientRect();
  const dx = clientX - dragStart.x, dy = clientY - dragStart.y;
  view.centerX = dragStart.centerX - dx * dragStart.box.width / rect.width;
  view.centerY = dragStart.centerY - dy * dragStart.box.height / rect.height;
  applyView();
}
function commitDrag(clientX, clientY) {
  updateDrag(clientX, clientY);
}
function zoomAt(nextScale, clientX = stage.getBoundingClientRect().left + stage.clientWidth / 2, clientY = stage.getBoundingClientRect().top + stage.clientHeight / 2) { const oldBox = viewBox(), rect = stage.getBoundingClientRect(), fx = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height, focusX = oldBox.x + oldBox.width * fx, focusY = oldBox.y + oldBox.height * fy; view.scale = Math.max(limits.min, Math.min(limits.max, nextScale)); const nextBox = viewBox(); view.centerX = focusX + nextBox.width / 2 - nextBox.width * fx; view.centerY = focusY + nextBox.height / 2 - nextBox.height * fy; applyView(); render(); }
function resetView() { view.scale = 1; view.centerX = MAP_WIDTH / 2; view.centerY = MAP_HEIGHT / 2; applyView(); }
function pinchData(pair) { const [a, b] = pair; return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

if (!data?.stations?.length || !data?.railways?.length) throw new Error('地図データを読み込めませんでした。');
document.querySelector('#station-total').textContent = `${data.stations.length}駅`; document.querySelector('#source-label').textContent = `— ${data.stations.length}駅・${Object.keys(data.lines).length}路線 / ${new Date(data.generatedAt).toLocaleDateString('ja-JP')} 更新 —`; document.querySelector('.intro').textContent = `東京のJR東日本・西武鉄道・東京メトロ ${data.stations.length}駅・${Object.keys(data.lines).length}路線を、地図上で検索・表示します。`; document.querySelector('.map-header strong').textContent = '東京・JR / 西武 / 東京メトロ 駅マップ'; info.querySelector('h2').textContent = `${data.stations.length}駅を表示中`; info.querySelector('p').textContent = '地図上の駅を選ぶと、所属路線と接続を表示・強調します。'; info.querySelector('.card-tags').innerHTML = '<span>駅を選択</span>';
document.querySelector('#station-total').textContent = `${stationGroups.length}駅`;
document.querySelector('#source-label').textContent = `— ${stationGroups.length}駅・${Object.keys(data.lines).length}路線 / ${new Date(data.generatedAt).toLocaleDateString('ja-JP')} 更新 —`;
document.querySelector('.intro').textContent = `東京のJR東日本・西武鉄道・東京メトロ ${stationGroups.length}駅・${Object.keys(data.lines).length}路線を、地図上で検索・表示します。`;
info.querySelector('h2').textContent = `${stationGroups.length}駅を表示中`;
renderRoutes(); render(); applyView();
search.addEventListener('input', render); document.querySelector('#clear').addEventListener('click', () => { search.value = ''; selectedLines.clear(); Object.keys(data.lines).forEach(line => selectedLines.add(line)); renderRoutes(); render(); }); document.querySelectorAll('[data-layer]').forEach(input => input.addEventListener('change', render));
document.querySelector('#zoom-in').addEventListener('click', () => zoomAt(view.scale * 1.25)); document.querySelector('#zoom-out').addEventListener('click', () => zoomAt(view.scale / 1.25)); document.querySelector('#reset-view').addEventListener('click', resetView); document.querySelector('#close-card').addEventListener('click', clearStationSelection);
// Keep the map's drag/pinch handlers from capturing clicks intended for card controls.
[info, stationList].forEach(element => element.addEventListener('pointerdown', event => event.stopPropagation()));
stage.addEventListener('selectstart', event => event.preventDefault()); stage.addEventListener('wheel', event => { event.preventDefault(); zoomAt(view.scale * (event.deltaY < 0 ? 1.12 : .89), event.clientX, event.clientY); }, { passive: false }); stage.addEventListener('dblclick', event => { event.preventDefault(); zoomAt(view.scale * 1.5, event.clientX, event.clientY); });
stage.addEventListener('pointerdown', event => { didDrag = false; stage.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const pair = [...pointers.values()]; if (pair.length === 1) dragStart = { x: event.clientX, y: event.clientY, centerX: view.centerX, centerY: view.centerY, box: viewBox() }; if (pair.length === 2) { commitDrag(pair[0].x, pair[0].y); pinchStart = { ...pinchData(pair), scale: view.scale }; } });
stage.addEventListener('pointermove', event => { if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const pair = [...pointers.values()]; if (pair.length === 2 && pinchStart) { didDrag = true; const pinch = pinchData(pair); zoomAt(pinchStart.scale * pinch.distance / pinchStart.distance, pinch.x, pinch.y); } else if (pair.length === 1 && dragStart) { const dx = event.clientX - dragStart.x, dy = event.clientY - dragStart.y; if (Math.hypot(dx, dy) > 4) didDrag = true; updateDrag(event.clientX, event.clientY); } });
function activateMapTarget(target) { const stationNode = target?.closest?.('[data-station-id]'); if (stationNode) { const station = stationById.get(stationNode.dataset.stationId); if (station) { selectStation(station); return true; } } const lineNode = target?.closest?.('[data-map-line]'); if (lineNode) { focusLines([lineNode.dataset.mapLine]); return true; } return false; }
function endPointer(event) {
  const isTap = event.button === 0 && !didDrag && pointers.size === 1;
  const isDrag = didDrag && pointers.size === 1;
  const target = isTap ? document.elementFromPoint(event.clientX, event.clientY) : null;
  if (isDrag) commitDrag(event.clientX, event.clientY);
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (!pointers.size) dragStart = null;
  if (isTap) {
    handledTapAt = performance.now();
    activateMapTarget(target);
  }
}
stage.addEventListener('pointerup', endPointer); stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('click', event => {
  if (didDrag) return;
  if (performance.now() - handledTapAt < 500) return;
  activateMapTarget(event.target);
});
stage.addEventListener('keydown', event => { const shift = 48 / view.scale; if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(view.scale * 1.2); } else if (event.key === '-') { event.preventDefault(); zoomAt(view.scale / 1.2); } else if (event.key === '0') { event.preventDefault(); resetView(); } else if ({ArrowLeft:1,ArrowRight:1,ArrowUp:1,ArrowDown:1}[event.key]) { event.preventDefault(); view.centerX += event.key === 'ArrowLeft' ? -shift : event.key === 'ArrowRight' ? shift : 0; view.centerY += event.key === 'ArrowUp' ? -shift : event.key === 'ArrowDown' ? shift : 0; applyView(); } });
