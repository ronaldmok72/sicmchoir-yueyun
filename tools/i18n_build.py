# 把 tools/i18n_en_*.json（翻好的英文）合并成 src/i18n-en.js
# 用法：python tools/i18n_build.py
# 检查：每个中文都有翻译、{0} 这类占位没漏；单个字（座位/弥撒小标签、繁简对照表）不翻，免得撑破小格子
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, 'tools')
HAN = re.compile(r'[㐀-鿿]')
# 小标签（座位表、弥撒歌单的一两个字）照原样
SKIP = {'读一', '读二', '的那个。', '现在是'}

src, en = [], {}
for f in sorted(glob.glob(os.path.join(T, 'i18n_in_*.json'))):
    src += json.load(open(f, encoding='utf-8'))
for f in sorted(glob.glob(os.path.join(T, 'i18n_en_*.json'))):
    en.update(json.load(open(f, encoding='utf-8')))

# 手动修正（翻译时猜的）
FIX_FILE = os.path.join(T, 'i18n_fix.json')
fix = json.load(open(FIX_FILE, encoding='utf-8')) if os.path.exists(FIX_FILE) else {}
en.update(fix)
src += [k for k in fix if k not in set(src)]   # 手动加的新句子

missing, bad, p, t = [], [], {}, {}
for k in src:
    v = en.get(k)
    if v is None:
        missing.append(k); continue
    if not isinstance(v, str) or not v.strip() or v == k:
        continue
    if k not in fix and (len(k) <= 1 or k in SKIP) or len(k) > 300:   # 太长的（给 AI 的指示、祷文）不是画面上的字
        continue
    ks, vs = sorted(re.findall(r'\{\d+\}', k)), sorted(re.findall(r'\{\d+\}', v))
    if ks != vs:
        bad.append((k, v)); continue
    (t if ks else p)[k] = v

for k in missing[:20]: print('缺翻译:', k)
for k, v in bad[:20]: print('占位不对:', k, '→', v)
print('总共', len(src), '翻好', len(p) + len(t), f'(字 {len(p)} / 带占位 {len(t)})', '缺', len(missing), '占位错', len(bad))

out = '// 自动产生（tools/i18n_build.py），不要手改；要改翻译改 tools/i18n_fix.json 再跑一次\n' \
      'window.SIC_EN = ' + json.dumps({'p': p, 't': t}, ensure_ascii=False, separators=(',', ':')) + ';\n'
open(os.path.join(ROOT, 'src', 'i18n-en.js'), 'w', encoding='utf-8', newline='\n').write(out)
print('写好 src/i18n-en.js', len(out.encode('utf-8')) // 1024, 'KB')
# 字典改了 → i18n.js 里的 ?v= 跟着换，手机才会拿新的
import hashlib
ver = hashlib.md5(out.encode('utf-8')).hexdigest()[:8]
jp = os.path.join(ROOT, 'src', 'i18n.js')
js = open(jp, encoding='utf-8').read()
js2 = re.sub(r'i18n-en\.js\?v=\w+', 'i18n-en.js?v=' + ver, js)
if js2 != js:
    open(jp, 'w', encoding='utf-8', newline='').write(js2)
print('版本', ver)
sys.exit(1 if missing or bad else 0)
