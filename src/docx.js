// 做一个最简单的 Word 档（.docx），不用另外载入别人的库
// paras：[{ text, bold, size（字号 pt）, center, indent（第几层）, space（段前空多少 pt） }]；text 里的 **字** 会变粗体
const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function para(p) {
  const pPr = [
    `<w:spacing w:before="${(p.space || 0) * 20}" w:after="60"/>`,
    p.indent ? `<w:ind w:left="${p.indent * 360}" w:hanging="${p.bullet ? 240 : 0}"/>` : '',
    p.center ? '<w:jc w:val="center"/>' : '',
  ].join('');
  const sz = (p.size || 11) * 2;
  const runs = String(p.text ?? '').split('**').map((t, i) => !t ? '' :
    `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/>${p.bold || i % 2 ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`).join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
}

const FILES = paras => ({
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map(para).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
});

// zip（不压缩，Word 照样打得开）
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function zip(files) {
  const enc = new TextEncoder(), out = [], dir = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
    const head = (sig, extra) => {
      const h = new DataView(new ArrayBuffer(extra ? 46 : 30));
      h.setUint32(0, sig, true);
      let i = 4;
      if (extra) h.setUint16(i, 20, true), i += 2;          // 做这个 zip 的版本
      h.setUint16(i, 20, true); h.setUint16(i + 2, 0x0800, true);   // 要几版才打得开；名字用 UTF-8
      h.setUint16(i + 4, 0, true); h.setUint16(i + 6, 0, true); h.setUint16(i + 8, 0x21, true);   // 不压缩；时间 1980-01-01
      h.setUint32(i + 10, crc, true); h.setUint32(i + 14, d.length, true); h.setUint32(i + 18, d.length, true);
      h.setUint16(i + 22, n.length, true);
      if (extra) h.setUint32(42, off, true);
      return new Uint8Array(h.buffer);
    };
    out.push(head(0x04034b50), n, d);
    dir.push(head(0x02014b50, true), n);
    off += 30 + n.length + d.length;
  }
  const size = dir.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, dir.length / 2, true); end.setUint16(10, dir.length / 2, true);
  end.setUint32(12, size, true); end.setUint32(16, off, true);
  return new Blob([...out, ...dir, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export const docx = paras => zip(FILES(paras));
