// MSDS(물질안전보건자료) 텍스트에서 관리에 필요한 항목을 뽑는다.
// 회사마다 양식이 달라서, 항목 번호와 표준 문구(제품명, 신호어, H코드, CAS 번호 등)를 기준으로 찾는다.
(function (root) {
  const DOC_START = /(SECTION\s*1\s*[:.]?\s*)?(^|\s)1\s*[.):]?\s*화학\s*제품\s*과\s*회사/;
  const DATE = /((?:19|20)\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g;
  const NONE = /^(해당\s*(사항\s*)?없음|해당\s*안\s*됨|비해당|자료\s*없음|없음|해당하지\s*않|N\/?A\b|-$)/i;

  // GHS 그림문자: H코드로부터 정한다 (PDF의 그림문자는 이미지라 글자로 읽을 수 없음)
  const PICTOGRAMS = [
    { id: 'GHS01', name: '폭발성', codes: [200, 201, 202, 203, 204, 205, 240, 241] },
    { id: 'GHS02', name: '인화성', codes: [220, 221, 222, 223, 224, 225, 226, 228, 241, 242, 250, 251, 252, 260, 261] },
    { id: 'GHS03', name: '산화성', codes: [270, 271, 272] },
    { id: 'GHS04', name: '고압가스', codes: [280, 281] },
    { id: 'GHS05', name: '부식성', codes: [290, 314, 318] },
    { id: 'GHS06', name: '급성독성', codes: [300, 301, 310, 311, 330, 331] },
    { id: 'GHS07', name: '경고(자극성 등)', codes: [302, 312, 315, 317, 319, 332, 335, 336, 420] },
    { id: 'GHS08', name: '건강유해성', codes: [304, 334, 340, 341, 350, 351, 360, 361, 370, 371, 372, 373] },
    { id: 'GHS09', name: '수생환경유해성', codes: [400, 410, 411] },
  ];

  const CMR = [
    { code: 350, kind: '발암성', grade: 1 },
    { code: 351, kind: '발암성', grade: 2 },
    { code: 340, kind: '생식세포 변이원성', grade: 1 },
    { code: 341, kind: '생식세포 변이원성', grade: 2 },
    { code: 360, kind: '생식독성', grade: 1 },
    { code: 361, kind: '생식독성', grade: 2 },
  ];

  // 산업안전보건법 규제 항목. key는 공백을 뺀 문구로 찾는다.
  const REGULATIONS = [
    { id: 'measure', label: '작업환경측정 대상', keys: ['작업환경측정'] },
    { id: 'exam', label: '특수건강진단 대상', keys: ['특수건강진단'] },
    { id: 'managed', label: '관리대상 유해물질', keys: ['관리대상유해물질'] },
    { id: 'special', label: '특별관리물질', keys: ['특별관리물질'] },
    { id: 'limit', label: '허용기준 설정', keys: ['허용기준'] },
    { id: 'permit', label: '허가대상 유해물질', keys: ['허가대상'] },
    { id: 'banned', label: '제조 등 금지물질', keys: ['제조등금지', '제조금지'] },
    { id: 'oel', label: '노출기준 설정', keys: ['노출기준설정'] },
  ];

  function casValid(cas) {
    const digits = cas.replace(/-/g, '');
    const check = Number(digits.slice(-1));
    const body = digits.slice(0, -1).split('').reverse();
    const sum = body.reduce((s, d, i) => s + Number(d) * (i + 1), 0);
    return sum % 10 === check;
  }

  function squash(s) {
    return s.replace(/\s+/g, '');
  }

  function datesIn(line) {
    const out = [];
    for (const m of line.matchAll(DATE)) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
    return out;
  }

  // 여러 MSDS를 묶은 PDF를 제품별로 나눈다. 1번 항목이 나오는 쪽에서 새 제품이 시작된다.
  function splitDocuments(pages) {
    const docs = [];
    pages.forEach((lines, idx) => {
      const starts = lines.some((l) => DOC_START.test(l) && !/목\s*차/.test(l));
      if (starts || docs.length === 0) docs.push({ pages: [], lines: [], pageLines: [] });
      const doc = docs[docs.length - 1];
      doc.pages.push(idx + 1);
      doc.pageLines.push(lines);
      doc.lines.push(...lines);
    });
    return docs;
  }

  function cleanName(s) {
    return s
      .replace(/㈜/g, '(주)')
      .replace(/\(주\)\s+/g, '(주)')
      .replace(/^[\s:：\-–·∘○•]+/, '')
      .replace(/\s+\d+\s*\/\s*\d+\s*$/, '') // 머리글의 쪽 번호 "1/7"
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function findName(lines) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/제\s*품\s*명\s*(.*)$/);
      if (!m || /제품명\s*(및|과)/.test(lines[i])) continue;
      let name = cleanName(m[1]);
      for (let j = i + 1; !name && j < Math.min(lines.length, i + 4); j++) {
        const next = cleanName(lines[j].replace(/^\s*제\s*품\s*명\s*/, ''));
        if (next && !/^\d+(\.\d+)*\.?\s/.test(next) && !/^[나-하]\.\s/.test(next)) name = next;
      }
      if (name) return name.slice(0, 80);
    }
    return '';
  }

  function findCompany(lines) {
    const label = /(제\s*조\s*회\s*사|제\s*조\s*사|제\s*조\s*자|회\s*사\s*명|공\s*급\s*자|판\s*매\s*사)\s*(정보)?/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(label);
      if (!m) continue;
      if (/수입품/.test(lines[i])) continue;
      let rest = cleanName(lines[i].slice(m.index + m[0].length).replace(/^[\s:：]+/, ''));
      if (/^(\/|및|정보|유통)/.test(rest)) rest = '';
      if (!rest && i + 1 < lines.length) {
        const next = cleanName(lines[i + 1]);
        if (/(주식회사|㈜|\(주\)|코리아|산업|화학|Inc|Co\.|Ltd)/i.test(next)) rest = next;
      }
      rest = rest.replace(/^[①-⑳\s]*(회\s*사\s*명|제\s*조\s*회\s*사|상\s*호)?\s*[:：]?\s*/, '');
      if (rest && !/(주소|연락처|전화)/.test(rest)) return rest.split(/\s{3,}/)[0].slice(0, 40);
    }
    return '';
  }

  function findSignal(lines) {
    for (let i = 0; i < lines.length; i++) {
      if (!/신\s*호\s*어/.test(lines[i])) continue;
      for (let j = i; j < Math.min(lines.length, i + 4); j++) {
        const text = j === i ? lines[j].replace(/.*신\s*호\s*어/, '') : lines[j];
        const m = text.match(/(위험|경고|해당\s*없음)/);
        if (m) return m[1].replace(/\s/g, '');
      }
    }
    return '';
  }

  function findHazards(lines) {
    const found = new Map();
    for (const line of lines) {
      for (const m of line.matchAll(/\bH\s?([234]\d\d)[A-Za-z]{0,2}\b/g)) {
        const code = Number(m[1]);
        if (code < 200 || code > 420) continue;
        let text = line.slice(m.index + m[0].length).replace(/^[\s:：+H\d\-–]+/, '').trim();
        text = text.split(/\s{3,}/)[0].slice(0, 60);
        if ((text.match(/[가-힣A-Za-z]/g) || []).length < 4) text = '';
        if (!found.has(code) || (!found.get(code) && text)) found.set(code, text);
      }
    }
    return [...found.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([code, text]) => ({ code: 'H' + code, num: code, text }));
  }

  // 함유량(%) 칸의 값. KE 번호(예: KE-35400) 같은 다른 칸의 숫자는 건너뛴다.
  function findContent(text) {
    const re = /(KE\s*-\s*)?([<>≤≥]?\s*\d+(?:\.\d+)?\s*(?:[~∼-]\s*\d+(?:\.\d+)?)?)/g;
    for (const m of text.matchAll(re)) {
      if (m[1]) continue;
      const v = m[2].replace(/\s+/g, '');
      const nums = v.match(/\d+(?:\.\d+)?/g).map(Number);
      if (/^[<>≤≥]?0\d/.test(v) || nums.some((n) => n > 100)) continue;
      return v;
    }
    return '';
  }

  // 함유량 표기를 "10~20" 형식으로 맞춘다. 부등호는 남기고 % 기호는 뺀다.
  function normalizeContent(v) {
    return v.replace(/[∼～]/g, '~').replace(/(\d)\s*[-–]\s*(\d)/g, '$1~$2').replace(/%/g, '').replace(/\s+/g, '');
  }

  // 항목 번호 n의 줄들 (n번 제목부터 n+1번 제목 전까지). 못 찾으면 null.
  const SECTION_TITLES = {
    1: /화학\s*제품|회사/, 2: /유해|위험|구성/, 3: /구성|성분|조성|Composition/i, 4: /응급/,
  };
  function sectionLines(lines, n) {
    const head = (k) => (l) => new RegExp(`^\\s*(SECTION\\s*)?${k}\\s*[.:]?\\s*[가-힣A-Za-z]`).test(l) && SECTION_TITLES[k].test(l);
    const start = lines.findIndex(head(n));
    if (start < 0) return null;
    let end = lines.findIndex((l, i) => i > start && head(n + 1)(l));
    if (end < 0) end = Math.min(lines.length, start + 80);
    return lines.slice(start, end);
  }

  const CAS_RE = /(?<![\d-])(\d{2,7})-(\d{2})-(\d)(?![\d-])/g;

  // 3번 항목(구성성분)을 PDF에 적힌 순서대로 읽는다.
  // CAS 번호가 없는 줄은 "(자료없음)성분명", 비공개는 "영업비밀"로 둔다.
  function findIngredients(lines) {
    const sec = sectionLines(lines, 3);
    const out = [];
    const seen = new Set();
    for (const line of (sec || lines).slice(sec ? 1 : 0)) {
      if (/(물질명|화학물질명|CAS\s*(번호|No)|함유량|함량|구성\s*비)/i.test(line) && !line.match(CAS_RE)) continue;
      const cases = [...line.matchAll(CAS_RE)].filter((m) => casValid(m[0]));
      if (cases.length) {
        const m = cases[0];
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        const before = line.slice(0, m.index).trim().split(/\s{3,}/).filter(Boolean);
        let name = (before[0] || '').replace(/^[\s∘○•\-]+/, '');
        if (/^(CAS|물질명|화학물질명|해당\s*없음)/i.test(name)) name = '';
        out.push({ cas: m[0], name: name.slice(0, 50), alias: (before[1] || '').slice(0, 50), content: normalizeContent(findContent(line.slice(m.index + m[0].length))) });
        continue;
      }
      if (!sec) continue;
      const cols = line.trim().split(/\s{3,}/);
      const secret = /영업\s*(비밀|기밀)/.test(line);
      const last = cols[cols.length - 1].trim();
      const content = cols.length > 1 && /^[<>≤≥]?\s*\d+(\.\d+)?\s*([~∼-]\s*\d+(\.\d+)?)?\s*%?$/.test(last) ? findContent(last) : '';
      if (!secret && !content) continue;
      if (/^상기\s*외|^기타/.test(cols[0]) && !content) {
        out.push({ cas: secret ? '영업비밀' : '(자료없음)' + cols[0], name: cols[0].slice(0, 50), alias: '', content: '' });
        continue;
      }
      out.push({ cas: secret ? '영업비밀' : '(자료없음)' + cols[0], name: cols[0].slice(0, 50), alias: cols.length > 2 ? cols[1].slice(0, 50) : '', content: normalizeContent(content) });
    }
    // 표가 아니라 "함유량(%)  100"처럼 세로로 적힌 양식
    if (sec && out.length === 1 && !out[0].content) {
      const row = sec.find((l) => /함\s*유\s*량|함\s*량/.test(l) && findContent(l.replace(/.*(함\s*유\s*량|함\s*량)\s*(\(%\))?/, '')));
      if (row) out[0].content = normalizeContent(findContent(row.replace(/.*(함\s*유\s*량|함\s*량)\s*(\(%\))?/, '')));
    }
    return out;
  }

  function findRegulations(lines) {
    const hits = [];
    for (const reg of REGULATIONS) {
      let hit = null;
      for (let i = 0; i < lines.length && !hit; i++) {
        const flat = squash(lines[i]);
        const key = reg.keys.find((k) => flat.includes(k));
        if (!key) continue;
        let rest = flat.slice(flat.indexOf(key) + key.length).replace(/^(대상|물질|유해물질|유해인자|설정|준수|물질)+/, '').replace(/^[:：()\s]+/, '');
        if (!rest && i + 1 < lines.length) rest = squash(lines[i + 1]);
        if (NONE.test(rest)) continue;
        const cycle = flat.slice(flat.indexOf(key), flat.indexOf(key) + key.length + 16).match(/(측정|진단)주기[:：]?(\d+개월)/);
        hit = { id: reg.id, label: reg.label, detail: cycle ? `${cycle[1]}주기 ${cycle[2]}` : '' };
      }
      if (hit) hits.push(hit);
    }
    return hits;
  }

  function findExposureLimits(lines) {
    const out = [];
    for (const line of lines) {
      const m = line.match(/(TWA|STEL|C)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(ppm|mg\/m3|mg\/㎥|㎎\/㎥|f\/cc)/i);
      if (m && out.length < 6) out.push(line.trim().replace(/\s{2,}/g, ' ').slice(0, 90));
    }
    return out;
  }

  // 최종 개정일: "개정"·"Revision"이 적힌 줄의 날짜 중 가장 늦은 것. 없으면 최초 작성일을 쓴다.
  function findDates(lines) {
    let first = '';
    const revisions = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const here = datesIn(l);
      const nextDates = () => (here.length ? here : datesIn(lines[i + 1] || ''));
      if (!first && /(최\s*초\s*작\s*성|Date\s*of\s*issue|발\s*행\s*일|작\s*성\s*일)/i.test(l)) {
        const m = l.match(/(최\s*초\s*작\s*성|Date\s*of\s*issue|발\s*행\s*일|작\s*성\s*일)[^\d]*/i);
        first = datesIn(l.slice(m.index))[0] || datesIn(lines[i + 1] || '')[0] || '';
      }
      if (/(개\s*정|Revision)/i.test(l) && !/최\s*초/.test(l)) {
        const m = l.match(/(개\s*정|Revision)/i);
        const ds = datesIn(l.slice(m.index));
        revisions.push(...(ds.length ? ds : /최\s*종\s*개\s*정/.test(l) ? datesIn(lines[i + 1] || '') : []));
      }
    }
    const revised = revisions.sort().pop() || '';
    return { first, revised, latest: revised || first, usedFirst: !revised && !!first };
  }

  // ---------- 상세분석표 양식용 항목 ----------

  const USE_LABEL = /(제품의\s*)?(권\s*고\s*용\s*도(?!\s*와)|권\s*장\s*사\s*용|제품의\s*용\s*도|^\s*-?\s*용\s*도(?=\s*[:：]))/;
  const USE_HEADER = /권\s*고\s*용\s*도\s*와\s*사용상의\s*제한|^\s*1\.2\.?\s/;
  const USE_STOP = /(사용상의\s*제한|^\s*[다라]\.|^\s*1\.[3-9]|공급자|제조자|회\s*사\s*명)/;

  function findUse(sec1) {
    for (let i = 0; i < sec1.length; i++) {
      const l = sec1[i];
      const label = l.match(USE_LABEL);
      const header = USE_HEADER.test(l);
      if (!label && !header) continue;
      const after = label ? l.slice(label.index + label[0].length) : l.replace(/.*(사용상의\s*제한|1\.2\.?\s*\S+)/, '');
      const value = after.replace(/^\s*[:：]?\s*/, '').split(/\s{3,}/)[0].trim();
      if (value) return value;
      if (label) {
        const next = (sec1[i + 1] || '').trim();
        if (next && !USE_STOP.test(next) && !USE_LABEL.test(next)) return next.replace(/^[-·∘]\s*/, '');
        continue;
      }
      // 제목만 있고 내용은 다음 줄들에 있는 양식: 아래에 용도 표시 줄이 있으면 그쪽에서 처리한다
      const block = [];
      for (let j = i + 1; j < sec1.length; j++) {
        const n = sec1[j].trim();
        if (!n) continue;
        if (USE_LABEL.test(n)) { block.length = 0; break; }
        if (USE_STOP.test(n)) break;
        block.push(n.replace(/^[-·∘]\s*/, '').replace(/\.$/, ''));
      }
      if (block.length) return block.slice(0, 3).join(', ');
    }
    return '';
  }

  function normalizePhone(text) {
    const m = text.match(/(\+?82[\s-]?)?\(?0?\d{1,4}\)?[\s)~.-]*\d{3,4}[\s~.-]+\d{4}/);
    if (!m) return '';
    return m[0].trim().replace(/[()]/g, (c) => (c === ')' ? '-' : '')).replace(/[\s~.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  // 1번 항목의 회사 블록(제조자/수입자/공급자/판매자)을 나눠서 회사명과 전화번호를 모은다.
  function findParties(sec1) {
    const parties = [];
    let role = '';
    let cur = null;
    const roleOf = (t) => (/수\s*입/.test(t) && !/수입품의\s*경우/.test(t) ? 'importer' : /제\s*조/.test(t) ? 'maker' : /공\s*급|유\s*통/.test(t) ? 'supplier' : /판\s*매/.test(t) ? 'seller' : '');
    for (let i = 0; i < sec1.length; i++) {
      const l = sec1[i];
      const t = l.replace(/\(수입품의\s*경우[^)]*\)/, '');
      const nameLabel = t.match(/(제\s*조\s*회\s*사|판\s*매\s*사|회\s*사\s*명|상\s*호)\s*[:：]?\s*/);
      if (!nameLabel && /정\s*보|제조자|공급자|수입자|유통업자/.test(t) && !/(주\s*소|전\s*화|연\s*락|화학\s*제품과\s*회사)/.test(t)) {
        role = roleOf(t);
        // "1.3 공급자 정보" 다음 줄에 회사명만 있는 양식
        const next = (sec1[i + 1] || '').trim();
        if (next && !/[:：]/.test(next) && /(주식회사|㈜|\(주\)|코리아|산업|화학|상사|Inc|Co\.|Ltd)/i.test(next) && !/(주\s*소|전\s*화|회\s*사\s*명|제\s*품\s*명|제\s*조\s*회\s*사|판\s*매\s*사)/.test(next)) {
          cur = { role: role || 'supplier', name: cleanName(next), phone: '', emergency: '' };
          parties.push(cur);
        }
        continue;
      }
      if (nameLabel) {
        const name = cleanName(t.slice(nameLabel.index + nameLabel[0].length)).split(/\s{3,}/)[0];
        if (!name) continue;
        const own = roleOf(nameLabel[1]);
        cur = { role: own || role || 'supplier', name, phone: '', emergency: '' };
        parties.push(cur);
        continue;
      }
      const phone = normalizePhone(t.replace(/(주\s*소|FAX|팩스).*/i, ''));
      if (!phone) continue;
      const target = cur || (parties.push(cur = { role: role || 'supplier', name: '', phone: '', emergency: '' }), cur);
      if (/긴\s*급/.test(t)) target.emergency = target.emergency || phone;
      else if (/(전\s*화|연\s*락|Tel|☎)/i.test(t)) target.phone = target.phone || phone;
      else if (/^\s*\+?\d/.test(t) && /긴\s*급/.test(sec1[i - 1] || '')) target.emergency = target.emergency || phone;
    }
    return parties;
  }

  function templateFields(doc, lines) {
    const sec1 = sectionLines(lines, 1) || lines.slice(0, 40);
    const sec2 = sectionLines(lines, 2) || [];
    const parties = findParties(sec1).filter((p) => p.name || p.phone || p.emergency);
    const pick = parties.find((p) => p.role === 'importer' && p.name) || parties.find((p) => p.role === 'maker' && p.name) || parties.find((p) => p.name);
    const anyEmergency = parties.find((p) => p.emergency);
    const phone = (pick && (pick.emergency || pick.phone)) || (anyEmergency && anyEmergency.emergency) || (parties.find((p) => p.phone) || {}).phone || '';
    const first = (doc.pageLines && doc.pageLines[0]) || lines;
    const sub = first.join('\n').match(/(MSDS\s*번\s*호|MSDS\s*No\.?|제\s*출\s*번\s*호|승\s*인\s*번\s*호)\s*[:：]?\s*([A-Z0-9][A-Z0-9-]{5,})/i);
    const hangul = (lines.join('').match(/[가-힣]/g) || []).length;
    const letters = (lines.join('').match(/[A-Za-z]/g) || []).length;
    let fitness = '';
    if (hangul < letters * 0.05) fitness = '외국어';
    else if (sec2.length && /구\s*성\s*성\s*분/.test(sec2[0])) fitness = 'GHS 미개정';
    return {
      use: findUse(sec1),
      company: pick ? pick.name : '',
      companyRole: pick ? pick.role : '',
      phone,
      submissionNo: sub ? sub[2] : '',
      fitness,
    };
  }

  function analyzeDocument(doc, today) {
    const lines = doc.lines;
    const hazards = findHazards(lines);
    const nums = new Set(hazards.map((h) => h.num));
    const pictograms = PICTOGRAMS.filter((p) => p.codes.some((c) => nums.has(c))).map((p) => p.name);
    const cmr = CMR.filter((c) => nums.has(c.code)).map((c) => ({ kind: c.kind, grade: c.grade }));
    const dates = findDates(lines);
    const now = today || new Date();
    const ageYears = dates.latest ? (now - new Date(dates.latest)) / (365.25 * 24 * 3600 * 1000) : null;
    const signal = findSignal(lines);
    const ingredients = findIngredients(lines);
    const tpl = templateFields(doc, lines);

    const result = {
      name: findName(lines),
      company: findCompany(lines),
      pages: doc.pages,
      signal,
      hazards,
      pictograms,
      cmr,
      ingredients,
      regulations: findRegulations(lines),
      exposureLimits: findExposureLimits(lines),
      firstDate: dates.first,
      revisedDate: dates.revised,
      latestDate: dates.latest,
      dateFromFirst: dates.usedFirst,
      template: tpl,
      // 그림문자가 인쇄된 쪽 (원본 확인용)
      pictogramPage: doc.pages[Math.max(0, (doc.pageLines || []).findIndex((pl) => pl.some((l) => /그\s*림\s*문\s*자|픽\s*토/.test(l))))],
      ageYears: ageYears === null ? null : Math.round(ageYears * 10) / 10,
      warnings: [],
    };
    if (!result.name) result.warnings.push('제품명을 찾지 못함');
    if (!ingredients.length) result.warnings.push('구성성분(CAS 번호)을 찾지 못함');
    if (!hazards.length && signal !== '해당없음') result.warnings.push('유해·위험문구(H코드)를 찾지 못함');
    if (!result.latestDate) result.warnings.push('작성·개정일을 찾지 못함');
    if (lines.some((l) => /영업\s*비밀/.test(l))) result.warnings.push('영업비밀 성분 있음');
    return result;
  }

  function analyzePages(pages, today) {
    return splitDocuments(pages)
      .filter((d) => d.lines.join('').replace(/\s/g, '').length > 200)
      .map((d) => analyzeDocument(d, today));
  }

  const api = { analyzePages, splitDocuments, analyzeDocument, casValid, PICTOGRAMS, REGULATIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MsdsParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
