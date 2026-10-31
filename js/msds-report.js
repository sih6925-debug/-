// MSDS 분석 결과를 엑셀과 PDF 보고서로 만든다.
(function (root) {
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const CMR_CODES = ['H340', 'H341', 'H350', 'H351', 'H360', 'H361'];

  function cmrText(p) {
    return p.cmr.map((c) => `${c.kind} ${c.grade === 1 ? '1A/1B' : '2'}`).join(', ');
  }
  function regText(p) {
    return p.regulations.map((r) => r.label + (r.detail ? ` (${r.detail})` : '')).join(', ');
  }

  function summaryRows(s) {
    return [
      ['MSDS 분석 보고서'],
      ['작성일', today()],
      ['분석 파일', s.files.join(', ')],
      [],
      ['항목', '제품 수'],
      ['분석한 제품', s.total],
      ['CMR(발암성·변이원성·생식독성) 물질 포함', s.cmr],
      ['특수건강진단 대상 물질 포함', s.exam],
      ['작업환경측정 대상 물질 포함', s.measure],
      [`오래된 자료 (최종 개정 후 ${s.ageLimit}년 이상)`, s.old],
      ['자동 추출 결과 확인 필요', s.check],
    ];
  }

  // ---------- 엑셀 ----------
  function buildXlsx(products, s) {
    const XLSX = root.XLSX;
    const wb = XLSX.utils.book_new();

    const sum = XLSX.utils.aoa_to_sheet(summaryRows(s));
    sum['!cols'] = [{ wch: 44 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, sum, '요약');

    const head = ['번호', '제품명', '제조·공급사', '신호어', '유해성(그림문자)', 'H코드', 'CMR', '산안법 규제', '노출기준', '최초 작성일', '최종 개정일', '개정 후 경과(년)', '오래된 자료', '성분 수', '확인 필요', '파일', '쪽'];
    const rows = products.map((p, i) => [
      i + 1, p.name, p.company, p.signal, p.pictograms.join(', '), p.hazards.map((h) => h.code).join(', '),
      cmrText(p), regText(p), p.exposureLimits.join(' / '), p.firstDate, p.latestDate, p.ageYears,
      p.ageYears !== null && p.ageYears >= s.ageLimit ? '예' : '', p.ingredients.length, p.warnings.join(', '),
      p.file, `${p.pages[0]}-${p.pages[p.pages.length - 1]}`,
    ]);
    const list = XLSX.utils.aoa_to_sheet([head, ...rows]);
    list['!cols'] = [6, 30, 22, 8, 26, 30, 22, 36, 30, 12, 12, 10, 10, 8, 26, 20, 8].map((wch) => ({ wch }));
    list['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, list, '제품목록');

    const ing = [['제품명', '물질명', '이명(관용명)', 'CAS 번호', '함유량(%)']];
    products.forEach((p) => p.ingredients.forEach((g) => ing.push([p.name, g.name, g.alias, g.cas, g.content])));
    const ingSheet = XLSX.utils.aoa_to_sheet(ing);
    ingSheet['!cols'] = [30, 34, 30, 14, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ingSheet, '성분목록');

    const chem = [['CAS 번호', '물질명', '들어 있는 제품 수', '제품']];
    chemicalIndex(products).forEach((c) => chem.push([c.cas, c.name, c.products.length, c.products.join(', ')]));
    const chemSheet = XLSX.utils.aoa_to_sheet(chem);
    chemSheet['!cols'] = [14, 34, 14, 60].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, chemSheet, '성분별 제품');

    const hz = [['제품명', 'H코드', '유해·위험문구']];
    products.forEach((p) => p.hazards.forEach((h) => hz.push([p.name, h.code, h.text])));
    const hzSheet = XLSX.utils.aoa_to_sheet(hz);
    hzSheet['!cols'] = [30, 8, 60].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, hzSheet, '유해위험문구');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function chemicalIndex(products) {
    const map = new Map();
    products.forEach((p) => p.ingredients.forEach((g) => {
      if (!g.cas || g.cas === '영업비밀') return;
      const c = map.get(g.cas) || { cas: g.cas, name: '', products: [] };
      if (!c.name && g.name) c.name = g.name;
      if (!c.products.includes(p.name)) c.products.push(p.name);
      map.set(g.cas, c);
    }));
    return [...map.values()].sort((a, b) => b.products.length - a.products.length || a.cas.localeCompare(b.cas));
  }

  // ---------- PDF ----------
  let fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    const toBase64 = (buf) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    const files = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'];
    // 내 PC에서 바로 여는 버전은 fetch를 쓸 수 없어서 글꼴을 base64 스크립트(fonts/nanum.js)로 담아 둔다
    if (root.NANUM_FONTS_B64) {
      root.pdfMake.vfs = { [files[0]]: root.NANUM_FONTS_B64.regular, [files[1]]: root.NANUM_FONTS_B64.bold };
      root.pdfMake.fonts = { Nanum: { normal: files[0], bold: files[1], italics: files[0], bolditalics: files[1] } };
      fontsReady = Promise.resolve();
      return fontsReady;
    }
    fontsReady = Promise.all(files.map((f) => fetch('fonts/' + f).then((r) => {
      if (!r.ok) throw new Error('글꼴을 불러오지 못했습니다');
      return r.arrayBuffer();
    }))).then(([reg, bold]) => {
      root.pdfMake.vfs = { [files[0]]: toBase64(reg), [files[1]]: toBase64(bold) };
      root.pdfMake.fonts = { Nanum: { normal: files[0], bold: files[1], italics: files[0], bolditalics: files[1] } };
    }).catch((e) => { fontsReady = null; throw e; });
    return fontsReady;
  }

  async function buildPdf(products, s) {
    await loadFonts();
    const cell = (text, opts) => Object.assign({ text: text === null || text === undefined ? '' : String(text) }, opts || {});
    const headCell = (t) => cell(t, { style: 'th' });

    const summary = summaryRows(s).slice(5).map(([k, v]) => [cell(k), cell(v, { alignment: 'right', bold: true })]);

    const productTable = {
      table: {
        headerRows: 1,
        widths: [16, '*', 70, 36, 90, 110, 52, 36],
        body: [
          ['#', '제품명 / 제조·공급사', '유해성', '신호어', 'CMR', '산안법 규제', '최종 개정일', '경과(년)'].map(headCell),
          ...products.map((p, i) => [
            cell(i + 1),
            { stack: [cell(p.name, { bold: true }), cell(p.company, { color: '#52514e', fontSize: 7 })] },
            cell(p.pictograms.join(', ')),
            cell(p.signal),
            cell(cmrText(p), { color: p.cmr.length ? '#b02a2a' : undefined, bold: !!p.cmr.length }),
            cell(regText(p)),
            cell(p.latestDate || '확인 필요'),
            cell(p.ageYears === null ? '-' : p.ageYears, { alignment: 'right', bold: p.ageYears !== null && p.ageYears >= s.ageLimit }),
          ]),
        ],
      },
      layout: tableLayout,
      fontSize: 8,
    };

    const sections = [];
    const cmr = products.filter((p) => p.cmr.length);
    if (cmr.length) {
      sections.push({ text: 'CMR 물질 포함 제품', style: 'h2' });
      sections.push({ ul: cmr.map((p) => `${p.name}: ${p.hazards.filter((h) => CMR_CODES.includes(h.code)).map((h) => `${h.code} ${h.text}`).join(' / ')}`), margin: [0, 0, 0, 10] });
    }
    const regs = products.filter((p) => p.regulations.length);
    if (regs.length) {
      sections.push({ text: '산업안전보건법 규제 대상 물질 포함 제품', style: 'h2' });
      sections.push({ ul: regs.map((p) => `${p.name}: ${regText(p)}`), margin: [0, 0, 0, 10] });
    }
    const old = products.filter((p) => p.ageYears !== null && p.ageYears >= s.ageLimit).sort((a, b) => b.ageYears - a.ageYears);
    if (old.length) {
      sections.push({ text: `최종 개정 후 ${s.ageLimit}년 이상 지난 자료 (공급사에 최신본 확인 권장)`, style: 'h2' });
      sections.push({ ul: old.map((p) => `${p.name} (${p.company || '회사 미확인'}): ${p.latestDate}, ${p.ageYears}년 경과`), margin: [0, 0, 0, 10] });
    }
    const check = products.filter((p) => p.warnings.length);
    if (check.length) {
      sections.push({ text: '원본 확인이 필요한 항목', style: 'h2' });
      sections.push({ ul: check.map((p) => `${p.name || '(제품명 없음)'}: ${p.warnings.join(', ')} (${p.file} ${p.pages[0]}쪽)`), margin: [0, 0, 0, 10] });
    }

    const doc = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [32, 36, 32, 36],
      defaultStyle: { font: 'Nanum', fontSize: 9, lineHeight: 1.25 },
      styles: {
        h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
        h2: { fontSize: 12, bold: true, margin: [0, 10, 0, 6] },
        th: { bold: true, color: '#52514e', fontSize: 8 },
        muted: { color: '#7a7974', fontSize: 8 },
      },
      footer: (page, count) => ({ text: `${page} / ${count}`, alignment: 'center', style: 'muted', margin: [0, 10, 0, 0] }),
      content: [
        { text: 'MSDS 분석 보고서', style: 'h1' },
        { text: `작성일 ${today()} · 분석 파일 ${s.files.join(', ')}`, style: 'muted', margin: [0, 0, 0, 12] },
        { table: { widths: [240, 60], body: summary }, layout: tableLayout, margin: [0, 0, 0, 8] },
        { text: '제품별 요약', style: 'h2' },
        productTable,
        ...sections,
        { text: '이 보고서는 MSDS 원문에서 자동으로 추출한 결과입니다. 법적 판단이나 최종 확인은 원본 MSDS를 기준으로 하십시오.', style: 'muted', margin: [0, 14, 0, 0] },
      ],
    };

    return new Promise((resolve, reject) => {
      try { root.pdfMake.createPdf(doc).getBlob(resolve); } catch (e) { reject(e); }
    });
  }

  const tableLayout = {
    hLineWidth: (i) => (i === 0 ? 0 : 0.5),
    vLineWidth: () => 0,
    hLineColor: () => '#d8d7d2',
    paddingTop: () => 4,
    paddingBottom: () => 4,
  };

  root.MsdsReport = { buildXlsx, buildPdf, chemicalIndex, cmrText, regText };
})(window);
