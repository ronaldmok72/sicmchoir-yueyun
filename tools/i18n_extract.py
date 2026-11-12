# 从 App 原始码抽出所有要翻成英文的中文界面文字（跳过注释、团员/歌单等资料文件）
# 用法：python tools/i18n_extract.py  → 写 tools/i18n_keys.json（{"plain": [...], "pattern": [...]}）
# pattern 里的 {0} {1} 是程序填进去的东西（数字、名字），翻译时要保留
import glob, json, os, re, sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_JS = {'members-seed.js', 'duties-seed.js', 'songlist-history.js', 'quiz-data.js', 'renames-old.js',
           'i18n.js', 'i18n-en.js', 'songlist-import.js'}
HAN = re.compile(r'[㐀-鿿]')
ATTRS = ('placeholder', 'title', 'aria-label', 'alt', 'value', 'data-tip', 'label')

plain, pattern = set(), set()

def norm(s):
    return re.sub(r'\s+', ' ', s).strip()

CODEY = re.compile(r'=>|\s=\s|;|\.value|document\.|\)\s*\)')
def add_text(s):
    s = norm(s.replace('&#10;', ' '))
    if s and HAN.search(s) and not CODEY.search(s):
        (pattern if '{0}' in s else plain).add(s)

# ---------- JS 扫描：只看字符串，注释自然跳过 ----------
def scan_js(src):
    """回传 [(kind, value)]：kind='str' 普通字符串；'tpl' 模板（value = 片段列表，表达式位置用 None）"""
    out, i, n = [], 0, len(src)
    prev_sig = ''   # 上一个有意义的字符，用来判断 / 是除号还是正则
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        if c == '/' and (prev_sig == '' or prev_sig in '(,=:[!&|?{};+-*%<>~^'):
            # 正则字面量：跳过
            j, cls = i + 1, False
            while j < n:
                if src[j] == '\\': j += 2; continue
                if src[j] == '[': cls = True
                elif src[j] == ']': cls = False
                elif src[j] == '/' and not cls: break
                elif src[j] == '\n': break
                j += 1
            i = j + 1; prev_sig = 'x'; continue
        if c in '\'"':
            j, buf = i + 1, []
            while j < n and src[j] != c:
                if src[j] == '\\' and j + 1 < n:
                    nx = src[j + 1]
                    buf.append({'n': '\n', 't': '\t'}.get(nx, nx)); j += 2; continue
                if src[j] == '\n': break
                buf.append(src[j]); j += 1
            out.append(('str', ''.join(buf))); i = j + 1; prev_sig = 'x'; continue
        if c == '`':
            parts, i = scan_tpl(src, i + 1, out)
            out.append(('tpl', parts)); prev_sig = 'x'; continue
        if not c.isspace(): prev_sig = c
        i += 1
    return out

def scan_tpl(src, i, out):
    """从 ` 后面开始，回传 (片段列表, 结束位置)；${...} 里面的代码递归扫描（里面的字符串另外加进 out）"""
    parts, buf, n = [], [], len(src)
    while i < n:
        c = src[i]
        if c == '\\' and i + 1 < n:
            nx = src[i + 1]; buf.append({'n': '\n', 't': '\t'}.get(nx, nx)); i += 2; continue
        if c == '`':
            parts.append(''.join(buf)); return parts, i + 1
        if c == '$' and i + 1 < n and src[i + 1] == '{':
            parts.append(''.join(buf)); buf = []; parts.append(None)
            depth, j = 1, i + 2
            start = j
            while j < n and depth:
                ch = src[j]
                if ch in '\'"`':
                    # 跳过里面的字符串（递归扫描交给下面）
                    if ch == '`':
                        sub, j = scan_tpl(src, j + 1, out); out.append(('tpl', sub)); continue
                    k = j + 1
                    while k < n and src[k] != ch:
                        if src[k] == '\\': k += 1
                        k += 1
                    out.append(('str', src[j + 1:k])); j = k + 1; continue
                if ch == '{': depth += 1
                elif ch == '}': depth -= 1
                j += 1
            i = j; continue
        buf.append(c); i += 1
    parts.append(''.join(buf)); return parts, i

TAG = re.compile(r'<[^<>]*>')
ATTR_RE = re.compile(r'\b(?:' + '|'.join(ATTRS) + r')\s*=\s*"([^"]*)"')

def handle_markup(s):
    """一段字符串（可能带 HTML、带 {0} 占位）：拆成文字段和属性值"""
    for m in ATTR_RE.finditer(s):
        add_text(m.group(1))
    for run in TAG.split(s):
        add_text(run)

def handle_tpl(parts):
    # 把表达式换成 {k}，但表达式落在标签里面（属性里）时只当分隔
    s, k = '', 0
    for p in parts:
        if p is None:
            s += '\x00'
        else:
            s += p
    # 标签内的 \x00 不当占位：先把标签里的 \x00 去掉
    s = TAG.sub(lambda m: m.group(0).replace('\x00', ''), s)
    for m in ATTR_RE.finditer(s.replace('\x00', '')):
        add_text(m.group(1))
    for run in TAG.split(s):
        idx = [0]
        def rep(_):
            r = '{%d}' % idx[0]; idx[0] += 1; return r
        run2 = re.sub('\x00', rep, run)
        # 只有占位、没有中文 → 跳过；占位在两头的拿掉（两头是程序给的，不影响翻译）
        if not HAN.search(run2): continue
        t = norm(run2)
        if re.fullmatch(r'(\{\d+\}\s*)*[^{}]*?(\s*\{\d+\})*', t) and '{' in t:
            # 占位只在两头：去掉两头的占位，当普通字
            core = norm(re.sub(r'^(\{\d+\}\s*)+|(\s*\{\d+\})+$', '', t))
            if core and '{' not in core:
                add_text(core); continue
        # 重新编号
        c = [0]
        def ren(_):
            r = '{%d}' % c[0]; c[0] += 1; return r
        add_text(re.sub(r'\{\d+\}', ren, t))

def do_js(src):
    for kind, v in scan_js(src):
        if kind == 'str':
            if HAN.search(v): handle_markup(v)
        else:
            handle_tpl(v)

class H(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.in_script = False; self.in_style = False
    def handle_starttag(self, tag, attrs):
        if tag == 'script': self.in_script = True
        if tag == 'style': self.in_style = True
        for k, v in attrs:
            if k in ATTRS and v: add_text(v)
    def handle_endtag(self, tag):
        if tag == 'script': self.in_script = False
        if tag == 'style': self.in_style = False
    def handle_data(self, d):
        if self.in_script: do_js(d)
        elif not self.in_style: add_text(d)

for f in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
    H().feed(open(f, encoding='utf-8').read())
for f in sorted(glob.glob(os.path.join(ROOT, 'src', '*.js'))):
    if os.path.basename(f) in SKIP_JS: continue
    src = open(f, encoding='utf-8').read()
    if os.path.basename(f) == 'library.js':
        src = '\n'.join(l for l in src.split('\n') if not l.lstrip().startswith('{"id":'))
    do_js(src)

out = {'plain': sorted(plain), 'pattern': sorted(pattern)}
json.dump(out, open(os.path.join(ROOT, 'tools', 'i18n_keys.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('plain', len(plain), 'pattern', len(pattern), 'chars', sum(map(len, plain)) + sum(map(len, pattern)))
