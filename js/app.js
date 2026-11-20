/* Bengaluru Metro Station Viewer (version 2)
   All data is read from data/config.json and the files it names, so any layer can be
   replaced without changing this code. Map library: OpenLayers (lib/ol.js). */
(function () {
  'use strict';

  var CFG = null, map = null, STATIONS = [], selected = null, L = {};
  var hidden = { cat: {}, line: {} };
  var $ = function (id) { return document.getElementById(id); };
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
                          getText('walkCatchments', d.walkCatchments), getText('circles', d.circles)])
        .then(function (r) {
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
  function catOf(id) { return CFG.categories.filter(function (c) { return c.id === id; })[0] || CFG.categories[CFG.categories.length - 1]; }
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
    L.corps = new ol.layer.Vector({ source: new ol.source.Vector(), style: corpStyle });
    L.circles = new ol.layer.Vector({ visible: false, source: new ol.source.Vector(), style: circleStyle });
    L.walk = new ol.layer.Vector({ source: new ol.source.Vector(), style: walkStyle });
    L.lines = new ol.layer.Vector({ source: new ol.source.Vector(), style: lineStyle });
    L.halo = new ol.layer.Vector({ source: new ol.source.Vector(), style: haloStyle });
    L.stations = new ol.layer.Vector({ source: new ol.source.Vector(), style: stationStyle, declutter: true });
    var plans = Object.keys(L.plans).map(function (k) { return L.plans[k]; });
    map = new ol.Map({
      target: 'map',
      layers: [L.osm, L.sat].concat(plans).concat([L.landuse, L.corps, L.circles, L.walk, L.lines, L.halo, L.stations]),
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
      if (f) { tipEl.textContent = f.get('st').short + ' – ' + catOf(f.get('st').cat).label; tip.setPosition(e.coordinate); } else tip.setPosition(undefined);
    });
    map.on('singleclick', function (e) { var f = hit(e.pixel); if (f) select(f.get('st'), false); });
    map.getView().on('change:resolution', function () { L.stations.changed(); });
    wire();
  }

  // ------------------------------------------------------------ styles
  function visible(s) { return !hidden.cat[s.cat] && s.lines.some(function (l) { return !hidden.line[l]; }); }
  function radius(s) { return s.wd != null ? Math.max(5, 4 + 1.5 * Math.sqrt(s.wd / 1000)) : 6; }
  var cache = {};
  function stationStyle(f, res) {
    var s = f.get('st'); if (!visible(s)) return null;
    var lbl = res < 22, key = s.id + lbl; if (cache[key]) return cache[key];
    var r = radius(s), c = catOf(s.cat).colour, out = [];
    if (s.lines.length > 1) out.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r + 3.5,
      fill: new ol.style.Fill({ color: '#fff' }), stroke: new ol.style.Stroke({ color: lineCol(s.lines[1]), width: 3 }) }) }));
    if (s.provisional) {
      out.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r + 1.5, stroke: new ol.style.Stroke({ color: lineCol(s.lines[0]), width: 2 }) }) }));
      out.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r - 1, fill: new ol.style.Fill({ color: '#fff' }), stroke: new ol.style.Stroke({ color: c, width: 3.5 }) }), zIndex: 100000 - (s.wd || 0) }));
    } else {
      out.push(new ol.style.Style({ image: new ol.style.Circle({ radius: r, fill: new ol.style.Fill({ color: c }),
        stroke: new ol.style.Stroke({ color: lineCol(s.lines[0]), width: 3 }) }), zIndex: 100000 - (s.wd || 0) }));
    }
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
        cat: r.primary_category || 'unclassified', provisional: /^y/i.test(r.provisional || ''), wd: isNaN(wd) ? null : wd };
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
    var nc = count(function (s) { return s.cat; });
    $('catLegend').innerHTML = CFG.categories.filter(function (c) { return nc[c.id]; }).map(function (c) {
      return '<div class="item" data-cat="' + c.id + '"><span class="sw" style="background:' + c.colour + '"></span><span>' + esc(c.label) + '</span><span class="n">' + nc[c.id] + '</span></div>';
    }).join('') + '<div class="item" style="cursor:default"><span class="sw prov" style="border-color:#555"></span><span>Provisional (outline in type colour)</span><span></span></div>';
    var sch = {}; L.lines.getSource().getFeatures().forEach(function (f) { if (f.get('schematic') === true) sch[f.get('line')] = 1; });
    var nl = count(function (s) { return s.lines; });
    $('lineLegend').innerHTML = Object.keys(CFG.lines).map(function (l) {
      return '<div class="item" data-line="' + l + '"><span class="sw line' + (sch[l] ? ' dash' : '') + '" style="background:' + lineCol(l) + '"></span><span>' + l + ' Line' + (sch[l] ? ' <span class="muted">(schematic)</span>' : '') + '</span><span class="n">' + (nl[l] || 0) + '</span></div>';
    }).join('');
    $('corpLegend').innerHTML = Object.keys(CFG.corporations).map(function (k) {
      return '<span class="sw poly" style="background:' + hexA(CFG.corporations[k], 0.5) + '"></span><span>Bengaluru ' + k + '</span><span></span>';
    }).join('');
    $('luLegend').innerHTML = Object.keys(CFG.landuse.colours).map(function (k) {
      return '<span class="sw poly" style="background:' + CFG.landuse.colours[k] + '"></span><span>' + esc(k) + '</span><span></span>';
    }).join('');
    document.querySelectorAll('#catLegend .item[data-cat], #lineLegend .item[data-line]').forEach(function (el) {
      el.onclick = function () {
        var g = el.dataset.cat ? 'cat' : 'line', k = el.dataset.cat || el.dataset.line;
        hidden[g][k] = !hidden[g][k]; el.classList.toggle('off', hidden[g][k]);
        cache = {}; L.stations.changed(); L.lines.changed(); L.walk.changed(); L.circles.changed();
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
      var w = L.walk.getSource().getFeatures().filter(function (f) { return f.get('station_id') === s.id; })[0];
      if (w) L.halo.getSource().addFeature(new ol.Feature({ geometry: w.getGeometry() }));
      if (zoom) flyTo(c, Math.max(map.getView().getZoom(), 14.5));
    }
    try { history.replaceState(null, '', '#st-' + encodeURIComponent(s.id)); } catch (e) {}
  }
  function closeCard() { $('card').hidden = true; selected = null; L.halo.getSource().clear(); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  function renderCard(s) {
    var r = s.row, c = catOf(s.cat), h = '';
    h += '<h2><span>' + esc(s.short) + '</span></h2>';
    if (s.name !== s.short) h += '<div class="alt">' + esc(s.name) + '</div>';
    h += '<div class="chips">' + s.lines.map(function (l) { return '<span class="chip"><i style="background:' + lineCol(l) + '"></i>' + esc(l) + ' Line</span>'; }).join('') + '</div>';
    h += '<h3>Station type</h3><div class="chips"><span class="chip"><i style="background:' + (s.provisional ? '#fff' : c.colour) + ';border:2px solid ' + c.colour + '"></i><b>' + esc(c.label) + '</b>' + (s.provisional ? '&nbsp;(provisional)' : '') + '</span></div>';
    var tags = (r.tags || '').split(/\s*;\s*/).filter(Boolean).slice(0, 4);
    if (tags.length) h += '<div class="tagline">' + tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>';
    if (r.justification) h += '<p class="small">' + esc(r.justification) + '</p>';
    h += '<h3>Average daily ridership</h3>';
    if (fmt(r.weekday_avg_ridership)) {
      h += '<div class="grid2"><div><div class="lab">Weekday</div><div class="big">' + fmt(r.weekday_avg_ridership) + '</div></div><div><div class="lab">Weekend day</div><div class="big">' + fmt(r.weekend_avg_ridership) + '</div></div></div>';
      h += '<p class="small">Entries plus exits, September 2025 (BMRCL data via RTI).</p>';
    } else h += '<p class="small">No ridership data yet.</p>';
    if (r.walk_share_of_circle_pct) {
      h += '<h3>800 m walking access</h3>';
      h += '<div class="grid2"><div><div class="lab">Area within 800 m walk</div><div class="big">' + (+r.walk_area_km2).toFixed(2) + ' km²</div>' +
           '<div class="lab">of ' + (+r.circle_area_km2).toFixed(2) + ' km² circle (' + Math.round(+r.walk_share_of_circle_pct) + '%)</div></div>' +
           '<div><div class="lab">Streets and paths within 800 m walk</div><div class="big">' + (+r.street_km_walkable_800m).toFixed(1) + ' km</div>' +
           '<div class="lab">of ' + (+r.street_km_in_circle).toFixed(1) + ' km inside the circle</div></div></div>';
      var lost = (+r.street_km_detour_only || 0) + (+r.street_km_disconnected || 0);
      if (lost > 0) h += '<p class="small">' + (+r.street_km_detour_only).toFixed(1) + ' km of streets in the circle need a longer detour' +
        ((+r.street_km_disconnected) > 0.05 ? ', and ' + (+r.street_km_disconnected).toFixed(1) + ' km are not connected' : '') +
        '. Street length is the walkable road and path network (OpenStreetMap), not surveyed footpaths.</p>';
    }
    h += '<h3>Land use within the walk (2017)</h3><p>' + (r.landuse_top3 ? esc(r.landuse_top3) : 'Not available') + '</p>';
    if (r.data_flags) h += '<div class="flag">' + esc(r.data_flags.charAt(0).toUpperCase() + r.data_flags.slice(1)) + '</div>';
    if (s.lat != null) h += '<div class="actions"><button class="btn primary" id="cZoom">Zoom to station</button></div>';
    $('cardBody').innerHTML = h; $('card').hidden = false; $('card').scrollTop = 0;
    if (s.lat != null) $('cZoom').onclick = function () {
      var w = L.walk.getSource().getFeatures().filter(function (f) { return f.get('station_id') === s.id; })[0];
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
