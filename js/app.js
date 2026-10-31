(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const state = { products: [], files: [], pdfs: {}, template: null, filter: 'all', query: '', list: 'products', open: null, ageLimit: 3 };

  const FILTERS = [
    { id: 'all', label: '전체', test: () => true },
    { id: 'cmr', label: 'CMR 물질', status: 'critical', test: (p) => p.cmr.length > 0 },
    { id: 'exam', label: '특수건강진단 대상', status: 'serious', test: (p) => p.regulations.some((r) => r.id === 'exam') },
    { id: 'measure', label: '작업환경측정 대상', status: 'serious', test: (p) => p.regulations.some((r) => r.id === 'measure') },
    { id: 'old', label: '오래된 자료', status: 'warning', test: (p) => isOld(p) },
    { id: 'check', label: '확인 필요', status: 'warning', test: (p) => p.warnings.length > 0 },
  ];
  const isOld = (p) => p.ageYears !== null && p.ageYears >= state.ageLimit;

  // ---------- 화면 전환 ----------
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + t.dataset.view; });
  }));

  // ---------- 파일 읽기 ----------
  const drop = $('#drop');
  $('#file').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });

  async function handleFiles(fileList) {
    const files = [...fileList].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) return setStatus('PDF 파일만 올릴 수 있습니다.');
    for (const f of files) {
      setStatus(`${f.name} 읽는 중…`);
      try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        const pages = await PdfText.pdfToPages(pdf);
        const textLen = pages.reduce((n, p) => n + p.join('').length, 0);
        if (textLen < pdf.numPages * 30) {
          setStatus(`${f.name}: 글자를 읽을 수 없는 스캔 이미지 PDF로 보입니다. 텍스트가 들어 있는 PDF로 올려 주세요.`);
          continue;
        }
        const found = MsdsParser.analyzePages(pages).map((p) => Object.assign(p, {
          file: f.name,
          printed: p.signal === '해당없음' ? [] : p.pictograms.slice(),
          pictogramsChecked: false,
        }));
        state.pdfs[f.name] = pdf;
        state.products.push(...found);
        if (!state.files.includes(f.name)) state.files.push(f.name);
        setStatus(`${f.name}에서 제품 ${found.length}개를 찾았습니다.`);
      } catch (err) {
        console.error(err);
        setStatus(`${f.name}을(를) 읽지 못했습니다: ${err.message || err}`);
      }
    }
    render();
  }

  function setStatus(t) { $('#status').textContent = t; }

  // ---------- 그리기 ----------
  function render() {
    $('#result').hidden = state.products.length === 0;
    if (!state.products.length) return;
    renderTemplatePanel();
    renderTiles();
    renderChart();
    renderFilters();
    renderList();
  }

  function count(id) { return state.products.filter(FILTERS.find((f) => f.id === id).test).length; }

  function renderTiles() {
    const tiles = [
      { id: 'all', label: '분석한 제품', value: state.products.length, note: `파일 ${state.files.length}개` },
      { id: 'cmr', label: 'CMR 물질 포함', status: 'critical', value: count('cmr'), note: '발암성·변이원성·생식독성' },
      { id: 'exam', label: '특수건강진단 대상', status: 'serious', value: count('exam'), note: 'MSDS 15번 항목 기준' },
      { id: 'old', label: '오래된 자료', status: 'warning', value: count('old'), note: `최종 개정 후 ${state.ageLimit}년 이상` },
      { id: 'check', label: '확인 필요', status: 'warning', value: count('check'), note: '자동 추출이 불완전한 제품' },
    ];
    $('#tiles').innerHTML = tiles.map((t) => `
      <button class="tile" data-filter="${t.id}">
        <div class="label">${t.status ? `<span class="dot ${t.status}"></span>` : ''}${esc(t.label)}</div>
        <div class="value">${t.value}</div>
        <div class="note">${esc(t.note)}</div>
      </button>`).join('');
    $('#tiles').querySelectorAll('.tile').forEach((b) => b.addEventListener('click', () => {
      state.filter = b.dataset.filter; state.list = 'products'; render();
      $('#list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function renderChart() {
    const rows = MsdsParser.PICTOGRAMS.map((p) => ({ name: p.name, n: state.products.filter((x) => x.pictograms.includes(p.name)).length }))
      .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...rows.map((r) => r.n));
    $('#chart').innerHTML = rows.length ? rows.map((r) => `
      <div class="bar-label">${esc(r.name)}</div>
      <div class="bar-track" title="${esc(r.name)}: 제품 ${r.n}개 / 전체 ${state.products.length}개">
        <div class="bar-fill" style="width:${(r.n / max) * 85}%"></div><span class="bar-value">${r.n}</span>
      </div>`).join('') : '<p class="small">H코드가 있는 제품이 없습니다.</p>';
  }

  function renderFilters() {
    $('#filters').innerHTML = state.list === 'products' ? FILTERS.map((f) => `
      <button class="chip ${state.filter === f.id ? 'active' : ''}" data-filter="${f.id}">
        ${f.status ? `<span class="dot ${f.status}"></span>` : ''}${esc(f.label)} ${count(f.id)}
      </button>`).join('') : '';
    $('#filters').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.list === state.list));
  }

  function matches(p) {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    return [p.name, p.company, ...p.ingredients.map((g) => g.name + ' ' + g.cas)].join(' ').toLowerCase().includes(q);
  }

  function renderList() {
    if (state.list === 'chemicals') return renderChemicals();
    const f = FILTERS.find((x) => x.id === state.filter);
    const items = state.products.map((p, i) => ({ p, i })).filter(({ p }) => f.test(p) && matches(p));
    if (!items.length) { $('#list').innerHTML = '<p class="small">조건에 맞는 제품이 없습니다.</p>'; return; }
    $('#list').innerHTML = `<table>
      <thead><tr><th>제품명</th><th>신호어</th><th class="hide-sm">유해성</th><th>주의 표시</th><th class="hide-sm">최종 개정일</th></tr></thead>
      <tbody>${items.map(({ p, i }) => rowHtml(p, i) + (state.open === i ? detailHtml(p) : '')).join('')}</tbody></table>`;
    $('#list').querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => {
      const i = Number(tr.dataset.i); state.open = state.open === i ? null : i; renderList();
    }));
  }

  function rowHtml(p, i) {
    const tags = [];
    p.cmr.forEach((c) => tags.push(`<span class="tag critical"><span class="dot critical"></span>${esc(c.kind)} ${c.grade === 1 ? '1A/1B' : '2'}</span>`));
    p.regulations.filter((r) => r.id === 'exam' || r.id === 'measure' || r.id === 'special' || r.id === 'managed')
      .forEach((r) => tags.push(`<span class="tag serious"><span class="dot serious"></span>${esc(r.label)}</span>`));
    if (isOld(p)) tags.push(`<span class="tag warning"><span class="dot warning"></span>${p.ageYears}년 경과</span>`);
    if (p.warnings.length) tags.push(`<span class="tag warning"><span class="dot warning"></span>확인 필요</span>`);
    return `<tr class="row" data-i="${i}">
      <td><div class="name">${esc(p.name || '(제품명 없음)')}</div><div class="small">${esc(p.company)}</div></td>
      <td class="num">${esc(p.signal || "-")}</td>
      <td class="hide-sm"><div class="tags">${p.pictograms.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div></td>
      <td><div class="tags">${tags.join('')}</div></td>
      <td class="hide-sm num">${esc(p.latestDate || '-')}</td>
    </tr>`;
  }

  function detailHtml(p) {
    const ing = p.ingredients.length ? `<table><thead><tr><th>물질명</th><th>CAS 번호</th><th>함유량(%)</th></tr></thead><tbody>
      ${p.ingredients.map((g) => `<tr><td>${esc(g.name || g.alias || '-')}</td><td class="num">${esc(g.cas || '-')}</td><td class="num">${esc(g.content || '-')}</td></tr>`).join('')}
      </tbody></table>` : '<p class="small">찾지 못함</p>';
    return `<tr class="detail"><td colspan="5"><div class="detail-grid">
      <div><h3>구성성분</h3>${ing}</div>
      <div>
        <h3>유해·위험문구</h3>
        ${p.hazards.length ? `<ul>${p.hazards.map((h) => `<li><b>${esc(h.code)}</b> ${esc(h.text)}</li>`).join('')}</ul>` : '<p class="small">없음</p>'}
        <h3 style="margin-top:12px">산업안전보건법 규제</h3>
        ${p.regulations.length ? `<ul>${p.regulations.map((r) => `<li>${esc(r.label)}${r.detail ? ` (${esc(r.detail)})` : ''}</li>`).join('')}</ul>` : '<p class="small">해당 없음 또는 기재 없음</p>'}
        ${p.exposureLimits.length ? `<h3 style="margin-top:12px">노출기준</h3><ul>${p.exposureLimits.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <h3 style="margin-top:12px">자료 정보</h3>
        <p class="small">최초 작성 ${esc(p.firstDate || '-')} · 최종 개정 ${esc(p.latestDate || '-')} · ${esc(p.file)} ${p.pages[0]}~${p.pages[p.pages.length - 1]}쪽</p>
        ${p.warnings.length ? `<p class="small">⚠ ${esc(p.warnings.join(', '))}</p>` : ''}
      </div></div></td></tr>`;
  }

  function renderChemicals() {
    const list = MsdsReport.chemicalIndex(state.products.filter(matches));
    $('#list').innerHTML = list.length ? `<table>
      <thead><tr><th>물질명</th><th>CAS 번호</th><th>제품 수</th><th>들어 있는 제품</th></tr></thead>
      <tbody>${list.map((c) => `<tr><td>${esc(c.name || '-')}</td><td class="num">${esc(c.cas)}</td><td class="num">${c.products.length}</td><td class="small">${esc(c.products.join(', '))}</td></tr>`).join('')}</tbody></table>`
      : '<p class="small">CAS 번호가 있는 성분이 없습니다.</p>';
  }

  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => { state.list = b.dataset.list; render(); }));
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#age-limit').addEventListener('change', (e) => { state.ageLimit = Number(e.target.value); render(); });
  $('#btn-clear').addEventListener('click', () => {
    Object.assign(state, { products: [], files: [], pdfs: {}, filter: 'all', query: '', open: null });
    $('#picto-preview').hidden = true;
    $('#search').value = ''; setStatus(''); render();
  });

  // ---------- 회사 양식 채우기 ----------
  // 양식을 따로 올리지 않으면 대시보드에 들어 있는 회사 양식을 쓴다
  const DEFAULT_TEMPLATE_NAME = '분석_물질안전보건자료.ver002.xlsx';
  async function templateBytes() {
    if (state.template) return state.template.arrayBuffer();
    if (!window.MSDS_TEMPLATE_B64) throw new Error('기본 양식을 불러오지 못했습니다');
    return Uint8Array.from(atob(window.MSDS_TEMPLATE_B64), (c) => c.charCodeAt(0));
  }

  const PICTO_COLS = Object.entries(MsdsTemplate.PICTO_TO_COL).sort((a, b) => a[1].localeCompare(b[1]));
  const PICTO_SHORT = { '경고(자극성 등)': '경고', 건강유해성: 'CMR', 수생환경유해성: '수생환경' };

  function renderTemplatePanel() {
    $('#tpl-name').textContent = state.template ? `올린 양식: ${state.template.name}` : `기본 양식 사용: ${DEFAULT_TEMPLATE_NAME}`;
    $('#picto-table').innerHTML = `<table class="picto"><thead><tr><th>제품명</th>${PICTO_COLS.map(([name, col]) => `<th>${col}<br>${esc(PICTO_SHORT[name] || name)}</th>`).join('')}<th></th><th></th></tr></thead><tbody>
      ${state.products.map((p, i) => `<tr data-i="${i}"><td class="name">${esc(p.name || '(제품명 없음)')}</td>
        ${PICTO_COLS.map(([name]) => {
          const on = p.printed.includes(name);
          const diff = on !== (p.signal !== '해당없음' && p.pictograms.includes(name));
          return `<td class="${diff ? 'diff' : ''}"><input type="checkbox" data-name="${esc(name)}" ${on ? 'checked' : ''} aria-label="${esc(name)}"></td>`;
        }).join('')}
        <td><button class="link" data-view="${i}">원본 보기</button></td>
        <td>${p.pictogramsChecked ? '<span class="ok">✓ 확인</span>' : `<button class="link" data-ok="${i}">맞음</button>`}</td></tr>`).join('')}
      </tbody></table>`;
    $('#picto-table').querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
      const p = state.products[Number(cb.closest('tr').dataset.i)];
      p.printed = PICTO_COLS.map(([n]) => n).filter((n) => (n === cb.dataset.name ? cb.checked : p.printed.includes(n)));
      p.pictogramsChecked = true;
      renderTemplatePanel();
    }));
    $('#picto-table').querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => {
      state.products[Number(b.dataset.ok)].pictogramsChecked = true; renderTemplatePanel();
    }));
    $('#picto-table').querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showPage(state.products[Number(b.dataset.view)])));
    const notes = MsdsTemplate.reviewNotes(state.products);
    $('#notes-count').textContent = notes.length ? `${notes.length}건` : '';
    $('#tpl-notes').innerHTML = notes.length ? notes.map((n) => `<li><b>${esc(n.product)}</b>: ${esc(n.text)}</li>`).join('') : '<li>없음</li>';
  }

  async function showPage(p) {
    const box = $('#picto-preview');
    const pdf = state.pdfs[p.file];
    if (!pdf) return;
    box.hidden = false;
    box.innerHTML = `<div class="preview-head"><span>${esc(p.name)} · ${esc(p.file)} ${p.pictogramPage}쪽</span><button class="ghost" id="preview-close">닫기</button></div>`;
    $('#preview-close').addEventListener('click', () => { box.hidden = true; });
    const page = await pdf.getPage(p.pictogramPage);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    box.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('#tpl-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    state.template = f;
    renderTemplatePanel();
  });

  $('#btn-tpl').addEventListener('click', (e) => exportWith(e.currentTarget, async (products) => {
    const zip = await JSZip.loadAsync(await templateBytes(), { createFolders: false });
    const r = await MsdsTemplate.fillTemplate(zip, products, { pictograms: (p) => p.printed });
    setStatus(`양식의 ${r.startRow}~${r.endRow}행에 제품 ${r.products}개를 넣었습니다.`);
    const macro = /\.xlsm$/i.test(state.template ? state.template.name : DEFAULT_TEMPLATE_NAME);
    return zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      mimeType: macro ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }, () => '[클로드] ' + (state.template ? state.template.name : DEFAULT_TEMPLATE_NAME)));

  // ---------- 보고서 ----------
  function summary() {
    return { files: state.files, total: state.products.length, cmr: count('cmr'), exam: count('exam'), measure: count('measure'), old: count('old'), check: count('check'), ageLimit: state.ageLimit };
  }
  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

  async function exportWith(btn, build, filename) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '만드는 중…';
    try {
      const blob = await build(state.products, summary());
      const name = typeof filename === 'function' ? filename() : filename;
      const r = await SaveFile.saveFile(name, blob);
      toast(r === 'declined' ? '저장을 취소했습니다.' : `${name} 파일을 저장했습니다.`);
    } catch (e) {
      console.error(e);
      toast(e && e.code === 'rejected_extension'
        ? 'Claude 미리보기 화면에서는 매크로 파일(.xlsm)을 내려받을 수 없습니다. 일반 웹 주소로 열면 받을 수 있습니다.'
        : '보고서를 만들지 못했습니다: ' + (e.message || e.code || e));
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }
  $('#btn-xlsx').addEventListener('click', (e) => exportWith(e.currentTarget, MsdsReport.buildXlsx, `MSDS_report_${stamp()}.xlsx`));
  $('#btn-pdf').addEventListener('click', (e) => exportWith(e.currentTarget, MsdsReport.buildPdf, `MSDS_report_${stamp()}.pdf`));

  let toastTimer;
  function toast(t) {
    const el = $('#toast'); el.textContent = t; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }
})();
