// 회사 양식 엑셀("MSDS_상세분석표" 시트)에 MSDS 분석 결과를 채운다.
// 양식의 글꼴·행높이·그림·메모·외부연결 수식(V~AG)을 그대로 두려고, 엑셀 파일(zip) 안의 시트 XML에서 값 칸만 고친다.
(function (root) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const SHEET_NAME = 'MSDS_상세분석표';
  const FIRST_ROW = 5;
  const MERGE_COLS = 'ABCDEFGHIJKLMNOPQRS'.split('');
  const PICTO_COLS = { K: '인화성', L: '산화성', M: '폭발성', N: '급성독성', O: '부식성', P: 'CMR', Q: '고압가스', R: '수생환경', S: '경고' };

  // 그림문자 이름(파서 기준) → 양식 열
  const PICTO_TO_COL = { 인화성: 'K', 산화성: 'L', 폭발성: 'M', 급성독성: 'N', 부식성: 'O', 건강유해성: 'P', 고압가스: 'Q', 수생환경유해성: 'R', '경고(자극성 등)': 'S' };

  // NodeList를 배열로 (Node의 xmldom은 펼치기(...)를 지원하지 않음)
  const els = (node, tag) => Array.from(node.getElementsByTagName(tag));
  const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const splitRef = (ref) => { const m = ref.match(/^([A-Z]+)(\d+)$/); return [m[1], Number(m[2])]; };

  function excelSerial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  async function sheetPath(zip, parser) {
    const wb = parser.parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml');
    const sheets = els(wb, 'sheet');
    const sheet = sheets.find((s) => s.getAttribute('name') === SHEET_NAME);
    if (!sheet) throw new Error(`"${SHEET_NAME}" 시트를 찾지 못했습니다.`);
    const rid = sheet.getAttributeNS(REL_NS, 'id') || sheet.getAttribute('r:id');
    const rels = parser.parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml');
    const rel = els(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
    const target = rel.getAttribute('Target').replace(/^\//, '');
    return target.startsWith('xl/') ? target : 'xl/' + target;
  }

  function cellHasValue(c) {
    const v = c.getElementsByTagName('v')[0];
    const t = c.getElementsByTagName('t')[0];
    return (v && v.textContent !== '') || (t && t.textContent !== '');
  }

  // 양식 한 장에 넣을 행들 (제품 단위로 묶음)
  function buildRows(products, picks) {
    return products.map((p) => {
      const t = p.template || {};
      const pictos = picks && picks(p) ? picks(p) : p.pictograms;
      const flags = {};
      if (p.signal !== '해당없음') pictos.forEach((name) => { if (PICTO_TO_COL[name]) flags[PICTO_TO_COL[name]] = 'O'; });
      const ing = p.ingredients.length ? p.ingredients : [{ cas: '', content: '' }];
      return {
        product: p,
        head: {
          C: p.name,
          D: t.use || '',
          E: t.company || p.company || '',
          F: t.phone || '',
          G: p.latestDate || '',
          H: t.submissionNo ? '○' : '',
          I: t.fitness || '',
          ...flags,
        },
        lines: ing.map((g) => ({ T: g.cas, U: g.content })),
      };
    });
  }

  async function fillTemplate(zip, products, options) {
    const opts = options || {};
    const parser = opts.parser || new DOMParser();
    const serializer = opts.serializer || new XMLSerializer();
    const path = await sheetPath(zip, parser);
    const doc = parser.parseFromString(await zip.file(path).async('string'), 'application/xml');
    const sheetData = doc.getElementsByTagName('sheetData')[0];
    const rows = new Map(els(sheetData, 'row').map((r) => [Number(r.getAttribute('r')), r]));

    // 이미 입력된 마지막 행과 마지막 순번
    let last = FIRST_ROW - 1;
    let lastNo = 0;
    rows.forEach((row, r) => {
      if (r < FIRST_ROW) return;
      els(row, 'c').forEach((c) => {
        const [col] = splitRef(c.getAttribute('r'));
        if (colNum(col) <= colNum('U') && cellHasValue(c)) {
          last = Math.max(last, r);
          if (col === 'A') {
            const n = Number((c.getElementsByTagName('v')[0] || {}).textContent);
            if (n) lastNo = Math.max(lastNo, n);
          }
        }
      });
    });

    const template = rows.get(FIRST_ROW);
    const styleOf = new Map();
    if (template) els(template, 'c').forEach((c) => styleOf.set(splitRef(c.getAttribute('r'))[0], c.getAttribute('s')));

    function getRow(r) {
      if (rows.has(r)) return rows.get(r);
      const row = doc.createElementNS(NS, 'row');
      row.setAttribute('r', String(r));
      if (template) ['spans', 'ht', 'customHeight'].forEach((a) => template.getAttribute(a) && row.setAttribute(a, template.getAttribute(a)));
      const after = [...rows.keys()].filter((k) => k > r).sort((a, b) => a - b)[0];
      sheetData.insertBefore(row, after ? rows.get(after) : null);
      rows.set(r, row);
      return row;
    }

    function getCell(r, col) {
      const row = getRow(r);
      const ref = col + r;
      const cells = els(row, 'c');
      let c = cells.find((x) => x.getAttribute('r') === ref);
      if (c) return c;
      c = doc.createElementNS(NS, 'c');
      c.setAttribute('r', ref);
      if (styleOf.has(col)) c.setAttribute('s', styleOf.get(col));
      const next = cells.find((x) => colNum(splitRef(x.getAttribute('r'))[0]) > colNum(col));
      row.insertBefore(c, next || null);
      return c;
    }

    function setCell(r, col, value) {
      if (value === '' || value === null || value === undefined) return;
      const c = getCell(r, col);
      while (c.firstChild) c.removeChild(c.firstChild);
      c.removeAttribute('t');
      if (typeof value === 'number') {
        const v = doc.createElementNS(NS, 'v');
        v.textContent = String(value);
        c.appendChild(v);
      } else {
        c.setAttribute('t', 'inlineStr');
        const is = doc.createElementNS(NS, 'is');
        const t = doc.createElementNS(NS, 't');
        t.setAttribute('xml:space', 'preserve');
        t.textContent = String(value);
        is.appendChild(t);
        c.appendChild(is);
      }
    }

    const merges = [];
    let r = last + 1;
    let no = lastNo;
    const startRow = r;
    for (const item of buildRows(products, opts.pictograms)) {
      const top = r;
      if (item.head.C) setCell(top, 'A', ++no);
      Object.entries(item.head).forEach(([col, v]) => {
        if (col === 'G') {
          const serial = excelSerial(v);
          setCell(top, col, serial === null ? v : serial);
        } else setCell(top, col, v);
      });
      item.lines.forEach((ln, i) => { setCell(top + i, 'T', ln.T); setCell(top + i, 'U', ln.U); });
      const bottom = top + item.lines.length - 1;
      if (bottom > top) MERGE_COLS.forEach((col) => merges.push(`${col}${top}:${col}${bottom}`));
      item.rows = [top, bottom];
      r = bottom + 1;
    }

    if (merges.length) {
      let mc = doc.getElementsByTagName('mergeCells')[0];
      if (!mc) {
        mc = doc.createElementNS(NS, 'mergeCells');
        const anchor = ['phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins']
          .map((n) => doc.getElementsByTagName(n)[0]).find(Boolean);
        sheetData.parentNode.insertBefore(mc, anchor ? anchor : sheetData.nextSibling);
      }
      merges.forEach((ref) => { const m = doc.createElementNS(NS, 'mergeCell'); m.setAttribute('ref', ref); mc.appendChild(m); });
      mc.setAttribute('count', String(mc.getElementsByTagName('mergeCell').length));
    }

    zip.file(path, serializer.serializeToString(doc), { createFolders: false });

    // 외부연결 수식(V~AG)이 새 CAS 번호로 다시 계산되게 한다
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    zip.file('xl/workbook.xml', /<calcPr\b[^>]*fullCalcOnLoad=/.test(wbXml) ? wbXml : wbXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"'), { createFolders: false });

    return { startRow, endRow: r - 1, products: products.length };
  }

  // 대체 처리했거나 판단이 필요한 항목
  function reviewNotes(products) {
    const notes = [];
    const add = (p, text) => notes.push({ product: p.name || '(제품명 없음)', text });
    products.forEach((p) => {
      const t = p.template || {};
      if (p.dateFromFirst) add(p, `최종 개정일자가 없어 최초 작성일(${p.latestDate})을 넣었습니다.`);
      if (!p.latestDate) add(p, '개정일자와 최초 작성일이 모두 비어 있어 G열을 비웠습니다.');
      if (!t.company) add(p, '회사명을 찾지 못했습니다.');
      if (!t.phone) add(p, '전화번호를 찾지 못했습니다.');
      if (!t.use) add(p, '권고 용도를 찾지 못했습니다.');
      if (!p.ingredients.length) add(p, '구성성분 표를 읽지 못했습니다. T·U열을 직접 확인해 주세요.');
      const secret = p.ingredients.filter((g) => g.cas === '영업비밀').length;
      if (secret) add(p, `CAS 번호 비공개 성분 ${secret}개를 "영업비밀"로 넣었습니다.`);
      const noCas = p.ingredients.filter((g) => /^\(자료없음\)/.test(g.cas)).length;
      if (noCas) add(p, `CAS 번호가 없는 성분 ${noCas}개를 "(자료없음)성분명"으로 넣었습니다.`);
      const noContent = p.ingredients.filter((g) => g.cas && !g.content).length;
      if (noContent) add(p, `함유량이 비어 있는 성분이 ${noContent}개 있습니다.`);
      if (t.fitness) add(p, `I열에 "${t.fitness}"를 넣었습니다.`);
    });
    const group = (list, text) => list.length && notes.unshift({ product: `${list.length}개 제품`, text: `${text} (${list.map((p) => p.name).join(', ')})` });
    group(products.filter((p) => (p.template || {}).companyRole === 'supplier'), '1번 항목에 제조사 표기가 없어 E열에 공급자를 넣었습니다.');
    group(products.filter((p) => p.pictogramsChecked === false), '그림문자를 아직 원본과 대조하지 않았습니다. H코드로 추정한 값입니다.');
    return notes;
  }

  const api = { fillTemplate, reviewNotes, buildRows, PICTO_COLS, PICTO_TO_COL, SHEET_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MsdsTemplate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
