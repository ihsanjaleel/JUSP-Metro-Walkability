"""Optional. Rebuilds data/fallback-data.js, the copy of the data used only when the viewer is
opened straight from a folder (double-click), where browsers block reading the data files.
Not needed on GitHub Pages. Run from the viewer folder:  python tools/make_fallback.py
"""
import json, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg_text = open(os.path.join(root, 'data', 'config.json'), encoding='utf-8').read()
out = {'config': cfg_text}
for key, rel in json.loads(cfg_text)['data'].items():
    p = os.path.join(root, rel)
    if rel and os.path.exists(p):
        out[key] = open(p, encoding='utf-8').read()
with open(os.path.join(root, 'data', 'fallback-data.js'), 'w', encoding='utf-8') as f:
    f.write('/* Built by tools/make_fallback.py; used only when the viewer is opened from a folder. */\n')
    f.write('window.FALLBACK_DATA = ' + json.dumps(out) + ';\n')
print('Wrote data/fallback-data.js:', ', '.join(out))
