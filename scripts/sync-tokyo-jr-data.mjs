import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const service = 'https://services.arcgis.com/wlVTGRSYTzAbjjiC/ArcGIS/rest/services';
const stationUrl = `${service}/RailroadStationPoint_view/FeatureServer/0/query`;
const railwayUrl = `${service}/RailroadSection_view/FeatureServer/0/query`;
const boundaryUrl = `${service}/BOUNDARY_CITY_SIMPLE_202401/FeatureServer/3/query`;
const operatorsWhere = "N02_004 IN ('東日本旅客鉄道', '東京地下鉄') OR N02_004 LIKE '%西武%' OR N02_004 LIKE '%東京都交通局%'";

async function queryAll(url, params) {
  const all = [];
  for (let offset = 0; ; offset += 2000) {
    const body = new URLSearchParams({ f: 'geojson', resultOffset: String(offset), resultRecordCount: '2000', ...params });
    const response = await fetch(`${url}?${body}`);
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    const json = await response.json(); all.push(...(json.features ?? []));
    if (!json.exceededTransferLimit || json.features.length < 2000) return all;
  }
}
function inRing([x, y], ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }
function inTokyo(point, boundaries) { return boundaries.some(({ geometry }) => { const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates; return polygons.some(polygon => inRing(point, polygon[0]) && !polygon.slice(1).some(hole => inRing(point, hole))); }); }
function roundGeometry(geometry) { const round = value => Math.round(value * 100000) / 100000; const roundCoordinates = coordinates => typeof coordinates[0] === 'number' ? [round(coordinates[0]), round(coordinates[1])] : coordinates.map(roundCoordinates); return { type: geometry.type, coordinates: roundCoordinates(geometry.coordinates) }; }
function geometryHasPointInBounds(geometry, bounds) { const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates]; return lines.some(line => line.some(([x, y]) => x >= bounds.minLng && x <= bounds.maxLng && y >= bounds.minLat && y <= bounds.maxLat)); }
function polygonHasPointInBounds(geometry, bounds) { const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]; return polygons.some(polygon => polygon.some(ring => ring.some(([x, y]) => x >= bounds.minLng && x <= bounds.maxLng && y >= bounds.minLat && y <= bounds.maxLat))); }

const boundariesAll = await queryAll(boundaryUrl, { where: "CITYCODE LIKE '13%'", outFields: 'CITYCODE,NAME', returnGeometry: 'true', outSR: '4326' });
const stationRecords = await queryAll(stationUrl, { where: operatorsWhere, outFields: 'N02_003,N02_004,N02_005', returnGeometry: 'true', outSR: '4326' });
const byStation = new Map();
for (const feature of stationRecords) {
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  if (!Number.isFinite(longitude) || !inTokyo([longitude, latitude], boundariesAll)) continue;
  const { N02_003: line, N02_004: operator, N02_005: name } = feature.properties;
  if (!name || !line) continue;
  const key = `${name}:${longitude.toFixed(5)}:${latitude.toFixed(5)}`;
  const station = byStation.get(key) ?? { id: `station-${encodeURIComponent(name)}-${longitude.toFixed(5)}-${latitude.toFixed(5)}`, name, longitude, latitude, lines: [], operators: [] };
  if (!station.lines.includes(line)) station.lines.push(line);
  if (!station.operators.includes(operator)) station.operators.push(operator);
  byStation.set(key, station);
}
const stations = [...byStation.values()].map(station => ({ ...station, lines: station.lines.sort((a, b) => a.localeCompare(b, 'ja')), operators: station.operators.sort((a, b) => a.localeCompare(b, 'ja')) })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
const lines = Object.fromEntries([...new Set(stations.flatMap(station => station.lines))].sort((a, b) => a.localeCompare(b, 'ja')).map(name => [name, stations.filter(station => station.lines.includes(name)).map(station => station.id)]));
const stationBounds = { minLng: Math.min(...stations.map(s => s.longitude)) - .025, maxLng: Math.max(...stations.map(s => s.longitude)) + .025, minLat: Math.min(...stations.map(s => s.latitude)) - .02, maxLat: Math.max(...stations.map(s => s.latitude)) + .02 };
const railwayRecords = await queryAll(railwayUrl, { where: operatorsWhere, outFields: 'N02_003,N02_004', returnGeometry: 'true', outSR: '4326' });
const railways = railwayRecords.filter(feature => lines[feature.properties.N02_003] && feature.geometry && geometryHasPointInBounds(feature.geometry, stationBounds)).map(feature => ({ line: feature.properties.N02_003, operator: feature.properties.N02_004, geometry: roundGeometry(feature.geometry) }));
const localBoundaries = boundariesAll.filter(feature => feature.geometry && polygonHasPointInBounds(feature.geometry, stationBounds)).map(feature => ({ name: feature.properties.NAME, geometry: roundGeometry(feature.geometry) }));
const lineOperators = Object.fromEntries(Object.keys(lines).map(line => { const railwayOperators = [...new Set(railways.filter(railway => railway.line === line).map(railway => railway.operator))]; return [line, (railwayOperators.length ? railwayOperators : [...new Set(stations.filter(station => station.lines.includes(line)).flatMap(station => station.operators))]).sort((a, b) => a.localeCompare(b, 'ja'))]; }));
const output = { schemaVersion: 3, generatedAt: new Date().toISOString(), scope: '東京都内に位置するJR東日本・西武鉄道・東京メトロ・都営地下鉄の駅と路線', sources: [{ name: '国土数値情報 鉄道データ（駅・路線）', url: 'https://nlftp.mlit.go.jp/ksj/' }, { name: '国土数値情報 行政区域データ', url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2024.html' }, { name: 'JR東日本 路線図（照合用）', url: 'https://www.jreast.co.jp/map/' }, { name: '西武鉄道 路線図（照合用）', url: 'https://www.seiburailway.jp/railway/station/' }, { name: '東京メトロ 路線図（照合用）', url: 'https://www.tokyometro.jp/station/index.html' }, { name: '都営地下鉄 路線図（照合用）', url: 'https://www.kotsu.metro.tokyo.jp/subway/' }], stations, lines, lineOperators, railways, boundaries: localBoundaries };
const target = resolve('data/tokyo-jr-stations.json'); await mkdir(dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8'); await writeFile(resolve('data/tokyo-jr-stations.js'), `window.TokyoJrData = ${JSON.stringify(output)};\n`, 'utf8');
console.log(`Wrote ${stations.length} stations, ${railways.length} railway sections, and ${localBoundaries.length} municipal boundaries to ${target}`);
