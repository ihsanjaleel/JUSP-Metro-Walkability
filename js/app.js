/* Bengaluru Metro Station Viewer (version 4)
   All data is read from data/config.json and the files it names, so any layer can be
   replaced without changing this code. Map library: OpenLayers (lib/ol.js). */
(function () {
  'use strict';

  var CFG = null, map = null, STATIONS = [], selected = null, L = {};
  var hidden = { line: {} };
  var $ = function (id) { return document.getElementById(id) || DUMMY; };
  // stand-in for a control that is missing from the page (for example an outdated index.html),
  // so the map and its layers still load
  var DUMMY = { style: {}, dataset: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    appendChild: function () {}, addEventListener: function () {}, querySelectorAll: function () { return []; }, getBoundingClientRect: function () { return { right: 0 }; }, hidden: true, value: '' };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return n == null || n === '' || isNaN(n) ? null : Math.round(+n).toLocaleString('en-IN'); };
  function setStatus(msg, warn) { var s = $('status'); s.innerHTML = msg || ''; s.className = 'status' + (warn ? ' warn' : ''); }

  // ------------------------------------------------------------ loading
  // On a web server the data files are fetched. Opened straight from a folder, browsers block
  // that, so the viewer loads data/fallback-data.js (built by tools/make_fallback.py) instead.
  var FALLBACK = null;
  function loadFallback() {
    if (FALLBACK) return Promise.resolve(FALLBACK);
    return new Promise(function (ok) {
      var s = document.createElement('script'); s.src = 'data/fallback-data.js';
      s.onload = function () { FALLBACK = window.FALLBACK_DATA || {}; ok(FALLBACK); };
      s.onerror = function () { FALLBACK = {}; ok(FALLBACK); };
      document.head.appendChild(s);
    });
  }
  function getText(key, url) {
    if (!url) return Promise.resolve(null);
    var viaFile = function () { return loadFallback().then(function (f) { return f[key] || null; }); };
    if (location.protocol === 'file:') return viaFile();
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url); return r.text(); }).catch(viaFile);
  }

  function boot() {
    getText('config', 'data/config.json').then(function (t) {
      if (!t) { setStatus('Could not read data/config.json.', true); return; }
      CFG = JSON.parse(t);
      $('appTitle').textContent = CFG.title; $('appSub').textContent = CFG.subtitle || ''; document.title = CFG.title;
      initMap();
      var d = CFG.data;
      return Promise.all([getText('stations', d.stations), getText('lines', d.lines), getText('corporations', d.corporations),
                          getText('walkCatchments', d.walkCatchments), getText('circles', d.circles),
                          getText('walk500', d.walk500), getText('mainRoads', d.mainRoads), getText('extensions', d.extensions),
                          getText('extTargets', d.extTargets), getText('entrances', d.entrances), getText('rings', d.rings),
                          getText('tenderSure', d.tenderSure)])
        .then(function (r) {
          [[5, L.walk500], [6, L.roads], [7, L.ext], [8, L.targets], [9, L.entr], [10, L.rings], [11, L.ts]].forEach(function (p) { if (r[p[0]]) addGeoJSON(p[1], r[p[0]]); });
          if (r[2]) addGeoJSON(L.corps, r[2]);
          if (r[1]) addGeoJSON(L.lines, r[1]);
          if (r[3]) addGeoJSON(L.walk, r[3]);
          if (r[4]) addGeoJSON(L.circles, r[4]);
          if (r[0]) setStations(r[0]); else setStatus('No station file found.', true);
          buildLegends();
          if (location.protocol === 'file:') setStatus('Opened from a folder: using the copy of the data built into the viewer. On GitHub Pages it reads the files in <code>data</code> directly.', false);
          if (!openFromHash()) fitAll();
          if (window.innerWidth <= 760 && !selected) togglePanel(true);
        });
    }).catch(function (e) { console.error(e); setStatus('Something went wrong while loading: ' + esc(e.message), true); });
  }

  // ------------------------------------------------------------ CSV
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    var head = rows.shift().map(function (h) { return h.trim(); });
    return rows.filter(function (r) { return r.join('').trim() !== ''; }).map(function (r) {
      var o = {}; head.forEach(function (h, k) { o[h] = (r[k] || '').trim(); }); return o;
    });
  }

  // ------------------------------------------------------------ map and layers
  var gj = new ol.format.GeoJSON();
  function addGeoJSON(layer, text) {
    var feats = gj.readFeatures(JSON.parse(text), { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
    layer.getSource().clear(); layer.getSource().addFeatures(feats);
  }
  function lineCol(n) { return CFG.lines[n] || '#777'; }
  function hexA(hex, a) { var h = hex.replace('#', ''); return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')'; }

  function initMap() {
    L.osm = new ol.layer.Tile({ source: new ol.source.OSM({ crossOrigin: 'anonymous' }) });
    L.sat = new ol.layer.Tile({ visible: false, source: new ol.source.XYZ({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 19, crossOrigin: 'anonymous', attributions: 'Imagery &copy; Esri' }) });
    L.plans = {};
    (CFG.planImages || []).forEach(function (p) {
      var lyr = p.type === 'cog' ? new ol.layer.WebGLTile({ visible: false, opacity: 0.7 })
        : new ol.layer.Tile({ visible: false, opacity: 0.7, source: new ol.source.XYZ({ url: p.url, maxZoom: 20, crossOrigin: 'anonymous', attributions: p.label }) });
      lyr.set('cfg', p); L.plans[p.id] = lyr;
      var o = document.createElement('option'); o.value = p.id; o.textContent = p.label; $('planSel').appendChild(o);
    });
    L.landuse = new ol.layer.Vector({ visible: false, opacity: 0.65, source: new ol.source.Vector(), style: landuseStyle });
    L.corps = new ol.layer.Vector({ visible: false, source: new ol.source.Vector(), style: corpStyle });
    L.circles = new ol.layer.Vector({ visible: false, source: new ol.source.Vector(), style: circleStyle });
    L.walk = new ol.layer.Vector({ visible: false, source: new ol.source.Vector(), style: walkStyle });
    L.rings = new ol.layer.Vector({ visible: false, source: new ol.source.Vector(), style: ringStyle });
    L.walk500 = new ol.layer.Vector({ source: new ol.source.Vector(), style: walk500Style });
    L.ts = new ol.layer.Vector({ visible: false, source: new ol.source.Vector(), style: tsStyle });
    L.roads = new ol.layer.Vector({ source: new ol.source.Vector(), style: roadStyle });
    L.ext = new ol.layer.Vector({ source: new ol.source.Vector(), style: extStyle });
    L.targets = new ol.layer.Vector({ source: new ol.source.Vector(), style: targetStyle, declutter: true });
    L.entr = new ol.layer.Vector({ visible: false, source: new ol.source.Vector(), style: entrStyle });
    L.lines = new ol.layer.Vector({ source: new ol.source.Vector(), style: lineStyle });
    L.halo = new ol.layer.Vector({ source: new ol.source.Vector(), style: haloStyle });
    L.stations = new ol.layer.Vector({ source: new ol.source.Vector(), style: stationStyle, declutter: true });
    var plans = Object.keys(L.plans).map(function (k) { return L.plans[k]; });
    map = new ol.Map({
      target: 'map',
      layers: [L.osm, L.sat].concat(plans).concat([L.landuse, L.corps, L.circles, L.walk, L.rings, L.walk500, L.ts, L.roads, L.ext, L.lines, L.targets, L.entr, L.halo, L.stations]),
      view: new ol.View({ center: ol.proj.fromLonLat(CFG.center), zoom: CFG.zoom, minZoom: 9.5, maxZoom: 20,
        extent: ol.proj.transformExtent(CFG.extent, 'EPSG:4326', 'EPSG:3857'), constrainOnlyCenter: true }),
      controls: ol.control.defaults.defaults({ attributionOptions: { collapsible: true } }).extend([new ol.control.ScaleLine()])
    });
    var tipEl = document.createElement('div'); tipEl.className = 'ol-tooltip';
    var tip = new ol.Overlay({ element: tipEl, offset: [12, -6], positioning: 'bottom-left' }); map.addOverlay(tip);
    var hit = function (px) { return map.forEachFeatureAtPixel(px, function (f) { return f; }, { layerFilter: function (l) { return l === L.stations; }, hitTolerance: 4 }); };
    map.on('pointermove', function (e) {
      var ll = ol.proj.toLonLat(e.coordinate); $('coords').textContent = ll[1].toFixed(5) + ', ' + ll[0].toFixed(5);
      if (e.dragging) return;
      var f = hit(e.pixel); map.getTargetElement().style.cursor = f ? 'pointer' : '';
      if (f) { var ss = f.get('st'); tipEl.textContent = ss.short + (ss.survey ? ' – footpath survey (' + ss.survey.toLowerCase() + ')' : ''); tip.setPosition(e.coordinate); return; }
      var g = map.forEachFeatureAtPixel(e.pixel, function (x, l) { return [x, l]; }, { layerFilter: function (l) { return l === L.roads || l === L.ext || l === L.targets || l === L.ts; }, hitTolerance: 3 });
      if (g) { tipEl.textContent = featTip(g[0], g[1]); tip.setPosition(e.coordinate); } else tip.setPosition(undefined);
    });
    map.on('singleclick', function (e) { var f = hit(e.pixel); if (f) select(f.get('st'), false); });
    map.getView().on('change:resolution', function () { L.stations.changed(); });
    wire();
  }

  // ------------------------------------------------------------ styles
  function visible(s) { return s.lines.some(function (l) { return !hidden.line[l]; }); }
  function radius(s) { return s.wd != null ? Math.max(5, 4 + 1.5 * Math.sqrt(s.wd / 1000)) : 6; }
  var cache = {};
  function stationStyle(f, res) {
    var s = f.get('st'); if (!visible(s)) return null;
    var lbl = res < 22, key = s.id + lbl; if (cache[key]) return cache[key];
    var r = radius(s), out = [];
    if (s.survey) out.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r + 6.5,
      fill: new ol.style.Fill({ color: 'rgba(254,218,10,0.55)' }), stroke: new ol.style.Stroke({ color: '#0E0F0F', width: 2.5 }) }) }));
    if (s.lines.length > 1) out.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r + 3.5,
      fill: new ol.style.Fill({ color: '#fff' }), stroke: new ol.style.Stroke({ color: lineCol(s.lines[1]), width: 3 }) }) }));
    out.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r, fill: new ol.style.Fill({ color: lineCol(s.lines[0]) }),
      stroke: new ol.style.Stroke({ color: '#fff', width: 2 }) }), zIndex: 100000 - (s.wd || 0) }));
    if (lbl) out.push(new ol.style.Style({ text: new ol.style.Text({ text: s.short, offsetY: -(r + 10), font: 'bold 11px Verdana, sans-serif',
      fill: new ol.style.Fill({ color: '#0E0F0F' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3.5 }) }) }));
    cache[key] = out; return out;
  }
  function lineStyle(f) {
    var n = f.get('line'); if (hidden.line[n]) return null;
    var sch = f.get('schematic') === true;
    return [new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#fff', width: 8 }) }),
            new ol.style.Style({ stroke: new ol.style.Stroke({ color: f.get('colour') || lineCol(n), width: 4.5, lineDash: sch ? [8, 7] : undefined }) })];
  }
  function corpStyle(f, res) {
    var k = f.get('corporation') || f.get('name'), col = CFG.corporations[k] || '#ccc';
    var st = [new ol.style.Style({ fill: new ol.style.Fill({ color: hexA(col, 0.18) }), stroke: new ol.style.Stroke({ color: '#0E0F0F', width: 1.4 }) })];
    if (res > 15) {
      if (!f.get('_lp')) { var g = f.getGeometry(), ps = g.getType() === 'MultiPolygon' ? g.getPolygons() : [g]; ps.sort(function (a, b) { return b.getArea() - a.getArea(); }); f.set('_lp', ps[0].getInteriorPoint(), true); }
      st.push(new ol.style.Style({ geometry: f.get('_lp'), text: new ol.style.Text({ text: k, font: 'bold 13px Raleway, Verdana, sans-serif',
        fill: new ol.style.Fill({ color: '#0E0F0F' }), stroke: new ol.style.Stroke({ color: '#fff', width: 4 }) }) }));
    }
    return st;
  }
  var walkSt = new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(42,202,217,0.22)' }), stroke: new ol.style.Stroke({ color: '#13808C', width: 1.3 }) });
  function walkStyle(f) { var s = stById[f.get('station_id')]; return s && !visible(s) ? null : walkSt; }
  var circSt = new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#0E0F0F', width: 1.1, lineDash: [6, 5] }) });
  function circleStyle(f) { var s = stById[f.get('station_id')]; return s && !visible(s) ? null : circSt; }
  function stOk(f) { var s = stById[f.get('station_id')]; return !(s && !visible(s)); }
  var w500St = new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(231,36,99,0.08)' }), stroke: new ol.style.Stroke({ color: '#E72463', width: 1.4 }) });
  function walk500Style(f) { return stOk(f) ? w500St : null; }
  var roadCache = {};
  function roadStyle(f, res) {
    if (!stOk(f)) return null;
    var t = f.get('road_type'), sch = !!f.get('scheme'), k = t + (res > 30 ? 's' : 'l') + (sch ? 'c' : ''); if (roadCache[k]) return roadCache[k];
    var col = (CFG.roadTypes || {})[t] || '#999', w = t === 'Arterial' ? 4 : (t === 'Service road' ? 2 : 3); if (res > 30) w = Math.max(1.2, w - 1.5);
    roadCache[k] = [new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(14,15,15,0.55)', width: w + 2 }) }),
                    new ol.style.Style({ stroke: new ol.style.Stroke({ color: col, width: w }) })];
    if (sch) roadCache[k].push(new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#fff', width: Math.max(1.2, w - 2), lineDash: [4, 6] }) }));
    return roadCache[k];
  }
  var extSt = new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#0E0F0F', width: 3, lineDash: [7, 5] }) });
  function extStyle(f) { return stOk(f) ? extSt : null; }
  function targetStyle(f, res) {
    if (!stOk(f)) return null;
    return new ol.style.Style({ image: new ol.style.RegularShape({ points: 4, radius: 7, angle: Math.PI / 4,
      fill: new ol.style.Fill({ color: f.get('kind') === 'Bus stop' ? '#0E0F0F' : '#9A1B44' }), stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 }) }),
      text: res < 12 ? new ol.style.Text({ text: f.get('name'), offsetY: -14, font: '11px Verdana, sans-serif',
        fill: new ol.style.Fill({ color: '#0E0F0F' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 }) }) : undefined });
  }
  var entrSt = new ol.style.Style({ image: new ol.style.RegularShape({ points: 4, radius: 4.5, angle: Math.PI / 4,
    fill: new ol.style.Fill({ color: '#0E0F0F' }), stroke: new ol.style.Stroke({ color: '#fff', width: 1 }) }) });
  function entrStyle(f, res) { return res < 15 && stOk(f) ? entrSt : null; }
  var ringSt = new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#5C5C5C', width: 1.5, lineDash: [8, 6] }) });
  function ringStyle(f, res) {
    return [ringSt, new ol.style.Style({ text: new ol.style.Text({ text: f.get('label'), placement: 'line', font: 'bold 11px Verdana, sans-serif',
      fill: new ol.style.Fill({ color: '#5C5C5C' }), stroke: new ol.style.Stroke({ color: '#fff', width: 3 }) }) })];
  }
  var tsSt = [new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#fff', width: 6 }) }), new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#5C5C5C', width: 3.5 }) })];
  function tsStyle() { return tsSt; }
  function featTip(f, l) {
    if (l === L.ts) return f.get('name') + ' – Tender S.U.R.E. (completed)';
    if (l === L.targets) return f.get('name') + ' – ' + (f.get('why') || f.get('kind'));
    if (l === L.ext) return 'Extension to ' + f.get('place') + ' (' + String(f.get('road_type')).toLowerCase() + ', ' + Math.round(f.get('length_m')) + ' m)';
    var n = f.get('name'), t = f.get('road_type');
    return (n ? n + ' – ' : '') + t + (t === 'Service road' ? ' (outer side)' : ' (' + (f.get('sides') === 1 ? 'one side of a divided road' : 'both sides') + ')') + (f.get('scheme') ? '. ' + f.get('scheme') : '');
  }
  function haloStyle(f) {
    if (f.getGeometry().getType() === 'Point') return new ol.style.Style({ image: new ol.style.Circle({ radius: selected ? radius(selected) + 9 : 12,
      fill: new ol.style.Fill({ color: 'rgba(254,218,10,0.35)' }), stroke: new ol.style.Stroke({ color: '#0E0F0F', width: 2 }) }) });
    return new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#0E0F0F', width: 2.5 }) });
  }
  function landuseStyle(f) {
    var v = f.get(CFG.landuse.field); var col = CFG.landuse.colours[v] || '#ddd';
    return new ol.style.Style({ fill: new ol.style.Fill({ color: col }) });
  }

  // ------------------------------------------------------------ stations
  var stById = {};
  function setStations(text) {
    STATIONS = parseCSV(text).map(function (r) {
      var lat = parseFloat(r.latitude), lon = parseFloat(r.longitude), wd = parseFloat(r.weekday_avg_ridership);
      return { row: r, id: r.station_id, name: r.station_name, short: r.short_name || r.station_name,
        lines: (r.line || '').split(/\s*[;,/]\s*/).filter(Boolean), lat: isNaN(lat) ? null : lat, lon: isNaN(lon) ? null : lon,
        survey: r.footpath_survey || '', wd: isNaN(wd) ? null : wd };
    });
    stById = {}; STATIONS.forEach(function (s) { stById[s.id] = s; });
    var feats = STATIONS.filter(function (s) { return s.lat != null; }).map(function (s) {
      var f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([s.lon, s.lat])) }); f.set('st', s); return f; });
    L.stations.getSource().clear(); L.stations.getSource().addFeatures(feats);
    var dl = $('stationList'); dl.innerHTML = '';
    STATIONS.filter(function (s) { return s.lat != null; }).sort(function (a, b) { return a.short.localeCompare(b.short); })
      .forEach(function (s) { var o = document.createElement('option'); o.value = s.short; dl.appendChild(o); });
  }

  // ------------------------------------------------------------ legends
  function count(fn) { var o = {}; STATIONS.forEach(function (s) { if (s.lat == null) return; [].concat(fn(s)).forEach(function (k) { o[k] = (o[k] || 0) + 1; }); }); return o; }
  function buildLegends() {
    var ns = count(function (s) { return s.survey ? 'y' : 'n'; });
    $('catLegend').innerHTML = '<div class="item" style="cursor:default"><span class="sw" style="background:rgba(254,218,10,0.55);border:2px solid #0E0F0F;border-radius:50%"></span><span>Selected for footpath survey</span><span class="n">' + (ns.y || 0) + '</span></div>';
    var sch = {}; L.lines.getSource().getFeatures().forEach(function (f) { if (f.get('schematic') === true) sch[f.get('line')] = 1; });
    var nl = count(function (s) { return s.lines; });
    $('lineLegend').innerHTML = Object.keys(CFG.lines).map(function (l) {
      return '<div class="item" data-line="' + l + '"><span class="sw line' + (sch[l] ? ' dash' : '') + '" style="background:' + lineCol(l) + '"></span><span>' + l + ' Line' + (sch[l] ? ' <span class="muted">(schematic)</span>' : '') + '</span><span class="n">' + (nl[l] || 0) + '</span></div>';
    }).join('');
    var nr = {}; L.roads.getSource().getFeatures().forEach(function (f) { var t = f.get('road_type'); nr[t] = (nr[t] || 0) + (+f.get('length_m') || 0); });
    $('roadLegend').innerHTML = Object.keys(CFG.roadTypes || {}).map(function (k) {
      return '<span class="sw line" style="background:' + CFG.roadTypes[k] + ';box-shadow:0 0 0 1px rgba(14,15,15,0.55)"></span><span>' + (k === 'Service road' ? 'Service road alongside' : k) + '</span><span class="n">' + ((nr[k] || 0) / 1000).toFixed(0) + ' km</span>';
    }).join('') + '<span class="sw line" style="background:repeating-linear-gradient(90deg,#9A1B44 0 4px,#fff 4px 8px)"></span><span>Rebuilt or funded by another scheme</span><span></span>';
    $('corpLegend').innerHTML = Object.keys(CFG.corporations).map(function (k) {
      return '<span class="sw poly" style="background:' + hexA(CFG.corporations[k], 0.5) + '"></span><span>Bengaluru ' + k + '</span><span></span>';
    }).join('');
    $('luLegend').innerHTML = Object.keys(CFG.landuse.colours).map(function (k) {
      return '<span class="sw poly" style="background:' + CFG.landuse.colours[k] + '"></span><span>' + esc(k) + '</span><span></span>';
    }).join('');
    document.querySelectorAll('#lineLegend .item[data-line]').forEach(function (el) {
      el.onclick = function () {
        var g = 'line', k = el.dataset.line;
        hidden[g][k] = !hidden[g][k]; el.classList.toggle('off', hidden[g][k]);
        cache = {}; [L.stations, L.lines, L.walk, L.circles, L.walk500, L.roads, L.ext, L.targets, L.entr].forEach(function (x) { x.changed(); });
      };
    });
  }

  // ------------------------------------------------------------ station panel
  function select(s, zoom) {
    selected = s; L.halo.getSource().clear();
    renderCard(s);
    if (s.lat != null) {
      var c = ol.proj.fromLonLat([s.lon, s.lat]);
      L.halo.getSource().addFeature(new ol.Feature({ geometry: new ol.geom.Point(c) }));
      var w = area500(s.id);
      if (w) L.halo.getSource().addFeature(new ol.Feature({ geometry: w.getGeometry() }));
      if (zoom) flyTo(c, Math.max(map.getView().getZoom(), 14.5));
    }
    try { history.replaceState(null, '', '#st-' + encodeURIComponent(s.id)); } catch (e) {}
  }
  function area500(id) { return L.walk500.getSource().getFeatures().filter(function (f) { return f.get('station_id') === id; })[0]; }
  function closeCard() { $('card').hidden = true; selected = null; L.halo.getSource().clear(); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  function renderCard(s) {
    var r = s.row, h = '';
    h += '<h2><span>' + esc(s.short) + '</span></h2>';
    if (s.name !== s.short) h += '<div class="alt">' + esc(s.name) + '</div>';
    h += '<div class="chips">' + s.lines.map(function (l) { return '<span class="chip"><i style="background:' + lineCol(l) + '"></i>' + esc(l) + ' Line</span>'; }).join('') + '</div>';
    if (s.survey) h += '<div class="flag">Footpath survey: ' + (s.survey === 'Pilot' ? 'pilot station' : 'selected station') + (r.pick_reason ? '<br><span class="small">' + esc(r.pick_reason) + '</span>' : '') + '</div>';
    if (r.area_zone) h += '<p class="small">' + esc(r.area_zone) + ' area' + (r.km_from_majestic ? ', ' + esc(r.km_from_majestic) + ' km from Majestic' : '') + '</p>';
    h += '<h3>Average daily ridership</h3>';
    if (fmt(r.weekday_avg_ridership)) {
      h += '<div class="grid2"><div><div class="lab">Weekday</div><div class="big">' + fmt(r.weekday_avg_ridership) + '</div></div><div><div class="lab">Weekend day</div><div class="big">' + fmt(r.weekend_avg_ridership) + '</div></div></div>';
      h += '<p class="small">Entries plus exits, September 2025 (BMRCL data via RTI).</p>';
    } else h += '<p class="small">No ridership data yet.</p>';
    if (r.footpath_km_500m !== '' && r.footpath_km_500m != null) {
      h += '<h3>Main roads within a 500 m walk</h3>';
      h += '<div class="grid2"><div><div class="lab">Footpath to survey</div><div class="big">' + (+r.footpath_km_500m).toFixed(1) + ' km</div>' +
           (r.area_500m_km2 ? '<div class="lab">Walk area ' + (+r.area_500m_km2).toFixed(2) + ' km²</div>' : '') + '</div>' +
           '<div><div class="lab">Road length by type</div><div>Arterial ' + (+r.arterial_km_500m).toFixed(1) + ' km<br>Sub-arterial ' + (+r.sub_arterial_km_500m).toFixed(1) + ' km<br>Collector ' + (+r.collector_km_500m).toFixed(1) + ' km<br>Service road alongside ' + (+r.service_km_500m || 0).toFixed(1) + ' km</div></div></div>';
      if (+r.scheme_footpath_km > 0) {
        var sc = {}; L.roads.getSource().getFeatures().forEach(function (f) { if (f.get('station_id') === s.id && f.get('scheme')) sc[f.get('name')] = f.get('scheme'); });
        h += '<p class="small"><b>Covered by other schemes</b> (' + (+r.scheme_footpath_km).toFixed(1) + ' km of footpath): ' + Object.keys(sc).map(function (n) { return esc(n) + ' – ' + esc(sc[n].toLowerCase()); }).join('; ') + '.</p>';
      }
      var ex = L.ext.getSource().getFeatures().filter(function (f) { return f.get('station_id') === s.id; }), places = {};
      ex.forEach(function (f) { var p = f.get('place'); places[p] = (places[p] || 0) + (+f.get('length_m') || 0); });
      if (ex.length) h += '<p class="small"><b>Extensions</b> (+' + (+r.extension_footpath_km).toFixed(1) + ' km of footpath): ' +
        Object.keys(places).map(function (p) { return esc(p) + ' (' + Math.round(places[p]) + ' m)'; }).join(', ') + '.</p>';
      h += '<p class="small">ArcGIS Pro, 500 m walk from the entrances. Arterial, sub-arterial and collector roads from OpenStreetMap; flyovers, underpasses and local streets not included.</p>';
    }
    h += '<h3>Land use around the station (2017)</h3><p>' + (r.landuse_top3 ? esc(r.landuse_top3) : 'Not available') + '</p>';
    if (s.lat != null) h += '<div class="actions"><button class="btn primary" id="cZoom">Zoom to station</button></div>';
    $('cardBody').innerHTML = h; $('card').hidden = false; $('card').scrollTop = 0;
    if (s.lat != null) $('cZoom').onclick = function () {
      var w = area500(s.id) || L.walk.getSource().getFeatures().filter(function (f) { return f.get('station_id') === s.id; })[0];
      if (w) map.getView().fit(w.getGeometry().getExtent(), { padding: pad(), duration: 600, maxZoom: 16 });
      else flyTo(ol.proj.fromLonLat([s.lon, s.lat]), 15.5);
    };
  }

  // ------------------------------------------------------------ view helpers
  function pad() {
    var w = window.innerWidth, h = window.innerHeight;
    if (w <= 760) return [70, 30, $('card').hidden ? 80 : Math.round(h * 0.6) + 20, 30];
    var left = $('panel').classList.contains('collapsed') ? 30 : $('panel').getBoundingClientRect().right + 20;
    return [30, $('card').hidden ? 60 : 380, 40, left];
  }
  function flyTo(coord, zoom) {
    var view = map.getView(), size = map.getSize(), p = pad(), res = view.getResolutionForZoom(zoom);
    var px = (p[3] + size[0] - p[1]) / 2, py = (p[0] + size[1] - p[2]) / 2;
    view.animate({ center: [coord[0] + (size[0] / 2 - px) * res, coord[1] - (size[1] / 2 - py) * res], zoom: zoom, duration: 600 });
  }
  function fitAll() { var e = L.stations.getSource().getExtent(); if (e && isFinite(e[0])) map.getView().fit(ol.extent.buffer(e, 1500), { padding: pad(), maxZoom: 13 }); }
  function openFromHash() {
    var m = /^#st-(.+)$/.exec(location.hash || ''); if (!m) return false;
    var s = stById[decodeURIComponent(m[1])]; if (s) { select(s, true); return true; } return false;
  }
  function togglePanel(force) {
    var p = $('panel'), c = force === true ? true : !p.classList.contains('collapsed');
    p.classList.toggle('collapsed', c); $('panelToggle').innerHTML = c ? '+' : '&#8211;';
  }

  // ------------------------------------------------------------ controls
  var landuseLoaded = false;
  function wire() {
    document.querySelectorAll('#baseSeg button').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#baseSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
        L.osm.setVisible(b.dataset.v === 'osm'); L.sat.setVisible(b.dataset.v === 'sat');
      };
    });
    $('lyrStations').onchange = function (e) { L.stations.setVisible(e.target.checked); L.halo.setVisible(e.target.checked); };
    $('lyrLines').onchange = function (e) { L.lines.setVisible(e.target.checked); };
    $('lyrWalk').onchange = function (e) { L.walk.setVisible(e.target.checked); };
    $('lyrWalk500').onchange = function (e) { L.walk500.setVisible(e.target.checked); };
    $('lyrRoads').onchange = function (e) { L.roads.setVisible(e.target.checked); };
    $('lyrExt').onchange = function (e) { L.ext.setVisible(e.target.checked); L.targets.setVisible(e.target.checked); };
    $('lyrEntr').onchange = function (e) { L.entr.setVisible(e.target.checked); };
    $('lyrRings').onchange = function (e) { L.rings.setVisible(e.target.checked); };
    $('lyrTS').onchange = function (e) { L.ts.setVisible(e.target.checked); };
    $('lyrCircles').onchange = function (e) { L.circles.setVisible(e.target.checked); };
    $('lyrCorps').onchange = function (e) { L.corps.setVisible(e.target.checked); };
    $('lyrLanduse').onchange = function (e) {
      var on = e.target.checked; L.landuse.setVisible(on); $('luLegend').hidden = !on;
      if (on && !landuseLoaded) {
        landuseLoaded = true; setStatus('Loading land use…');
        getText('landuse', CFG.data.landuse).then(function (t) {
          if (t) { addGeoJSON(L.landuse, t); setStatus(''); } else setStatus('Land-use file not found.', true);
        });
      }
    };
    $('planSel').onchange = function (e) {
      var id = e.target.value, op = parseFloat($('planOpacity').value);
      $('planNote').textContent = 'Plans show planned land use, not what is on the ground.';
      Object.keys(L.plans).forEach(function (k) {
        var lyr = L.plans[k], p = lyr.get('cfg'), on = k === id;
        if (on && p.type === 'cog' && !lyr.getSource()) {
          lyr.setSource(new ol.source.GeoTIFF({ sources: [{ url: p.url }], normalize: true, interpolate: true, transition: 0 }));
          lyr.getSource().on('change', function () {
            if (lyr.getSource().getState() === 'error') $('planNote').textContent = 'Could not load ' + p.label + '. Check its link in data/config.json, or host a copy.';
          });
        }
        lyr.setOpacity(op); lyr.setVisible(on);
        if (on) $('planNote').textContent = p.note || '';
      });
    };
    $('planOpacity').oninput = function (e) { Object.keys(L.plans).forEach(function (k) { L.plans[k].setOpacity(parseFloat(e.target.value)); }); };
    $('panelToggle').onclick = function () { togglePanel(); };
    $('cardClose').onclick = closeCard;
    $('aboutBtn').onclick = function () { $('about').hidden = false; };
    $('aboutClose').onclick = function () { $('about').hidden = true; };
    $('about').onclick = function (e) { if (e.target === this) this.hidden = true; };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('about').hidden) $('about').hidden = true; else if (!$('card').hidden) closeCard(); } });
    function doSearch() {
      var q = $('search').value.trim().toLowerCase(); if (!q) return;
      var s = STATIONS.filter(function (s) { return s.lat != null && (s.short.toLowerCase() === q || s.name.toLowerCase() === q); })[0] ||
              STATIONS.filter(function (s) { return s.lat != null && (s.short.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0); })[0];
      if (s) { setStatus(''); select(s, true); } else setStatus('No station matches “' + esc($('search').value) + '”.', false);
    }
    $('search').addEventListener('change', doSearch);
    $('search').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
  }

  window.MetroViewer = { get map() { return map; }, get stations() { return STATIONS; }, layers: L };
  boot();
})();
