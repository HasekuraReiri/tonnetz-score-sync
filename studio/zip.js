/* ==========================================================================
   zip.js — 浏览器内读取压缩 MusicXML（.mxl）
   .mxl 是 ZIP：读取 META-INF/container.xml 指向的 rootfile，或第一个 XML。
   ========================================================================== */

const EOCD = 0x06054b50;
const CD = 0x02014b50;

function findEocd(dv, len) {
  const min = Math.max(0, len - 65557);
  for (let i = len - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD) return i;
  }
  return -1;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持 DecompressionStream，无法解压 .mxl；请升级 Edge/Chrome，或改用 .musicxml。');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeText(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{text:string, entry:string, entries:string[]}>}
 */
export async function readMxl(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const len = bytes.length;
  if (len < 22) throw new Error('不是有效的 .mxl（文件过小）');
  const eocd = findEocd(dv, len);
  if (eocd < 0) throw new Error('不是有效的 .mxl（未找到 ZIP 目录）；请确认文件没有损坏。');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  if (!count || off >= len) throw new Error('不是有效的 .mxl（ZIP 目录为空）');

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > len || dv.getUint32(off, true) !== CD) throw new Error('.mxl 的 ZIP 目录损坏');
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const usize = dv.getUint32(off + 24, true);
    const fnLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const comLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = decodeText(bytes.subarray(off + 46, off + 46 + fnLen)).replace(/\\/g, '/');
    if (localOff + 30 > len) throw new Error('.mxl 的 ZIP 条目损坏');
    const lfn = dv.getUint16(localOff + 26, true);
    const lex = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lfn + lex;
    const dataEnd = dataStart + csize;
    if (dataEnd > len) throw new Error('.mxl 的 ZIP 数据损坏');
    entries.push({ name, method, csize, usize, data: bytes.subarray(dataStart, dataEnd) });
    off += 46 + fnLen + extraLen + comLen;
  }
  const names = entries.map(e => e.name);

  async function textOf(entry) {
    if (!entry) throw new Error('.mxl 中没有找到 MusicXML 文件');
    if (entry.method === 0) return decodeText(entry.data);
    if (entry.method === 8) return decodeText(await inflateRaw(entry.data));
    throw new Error(`.mxl 使用了不支持的 ZIP 压缩方式（method ${entry.method}）`);
  }

  const container = entries.find(e => e.name.toLowerCase() === 'meta-inf/container.xml');
  let rootPath = '';
  if (container) {
    try {
      const xml = await textOf(container);
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const rf = doc.querySelector('rootfile');
      if (rf) rootPath = (rf.getAttribute('full-path') || '').replace(/\\/g, '/');
    } catch (e) {
      /* fall through to first xml */
    }
  }
  let target = entries.find(e => rootPath && e.name === rootPath);
  if (!target) {
    target = entries.find(e => /\.(musicxml|xml)$/i.test(e.name) && !/^meta-inf\//i.test(e.name) && !/^mimetype$/i.test(e.name));
  }
  if (!target) target = entries.find(e => /\.(musicxml|xml)$/i.test(e.name));
  if (!target) throw new Error('.mxl 中没有 MusicXML（.xml / .musicxml）条目');
  const text = await textOf(target);
  if (!text.trim()) throw new Error('.mxl 中的 MusicXML 为空');
  return { text, entry: target.name, entries: names };
}
