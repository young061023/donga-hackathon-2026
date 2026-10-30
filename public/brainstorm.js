(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kinds = { topic: '핵심 주제', idea: '아이디어', problem: '문제', solution: '해결책', action: '실행' };
  // A force layout supports cross-links and cycles; concepts are not message nodes.
  function buildGraph(summary, previous = new Map()) {
    const width = Math.max(680, Math.min(1300, summary.concepts.length * 55));
    const height = Math.max(370, Math.min(1000, summary.concepts.length * 38));
    const nodes = summary.concepts.map((node, index, all) => {
      const old = previous.get(node.label);
      const angle = index * Math.PI * 2 / all.length;
      return { ...node, x: old?.x ?? width / 2 + Math.cos(angle) * width * .28, y: old?.y ?? height / 2 + Math.sin(angle) * height * .28 };
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const edges = summary.relations.filter(edge => byId.has(edge.source) && byId.has(edge.target));
    for (let step = 0; step < 180; step++) {
      const forces = new Map(nodes.map(node => [node.id, { x: (width / 2 - node.x) * .003, y: (height / 2 - node.y) * .003 }]));
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x || .1, dy = a.y - b.y || .1;
        const distance = Math.max(10, Math.hypot(dx, dy));
        const force = 15000 / (distance * distance);
        forces.get(a.id).x += dx / distance * force; forces.get(a.id).y += dy / distance * force;
        forces.get(b.id).x -= dx / distance * force; forces.get(b.id).y -= dy / distance * force;
      }
      for (const edge of edges) {
        const a = byId.get(edge.source), b = byId.get(edge.target);
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
        const force = (distance - 230) * .025;
        forces.get(a.id).x += dx / distance * force; forces.get(a.id).y += dy / distance * force;
        forces.get(b.id).x -= dx / distance * force; forces.get(b.id).y -= dy / distance * force;
      }
      for (const node of nodes) {
        const f = forces.get(node.id);
        node.x = Math.max(105, Math.min(width - 105, node.x + Math.max(-8, Math.min(8, f.x))));
        node.y = Math.max(55, Math.min(height - 55, node.y + Math.max(-8, Math.min(8, f.y))));
      }
    }
    return { nodes, edges, width, height };
  }
  function create({ onSelect, onSummary, onError, onStart }) {
    const $ = selector => document.querySelector(selector);
    let active = false, workspace, channelId, graph, summary, selectedId = null;
    let fingerprint = '', analyzedFingerprint = '', contextKey = '', version = 0;
    let excludedIds = new Set(), positions = new Map(), zoom = 1, busy = false, starting = false;
    let timer, lastRequestAt = 0, automaticBlocked = false;
    const clip = (text, length) => [...String(text)].slice(0, length).join('') + ([...String(text)].length > length ? '…' : '');
    const key = () => `${workspace?.team.id}:${channelId}`;
    const ideas = () => workspace.messages.filter(m => m.channelId === channelId && m.authorType === 'user' && !excludedIds.has(m.id)).slice(-80);
    const status = text => { $('#brainSummaryStatus').textContent = text; };
    const list = items => '<ul>' + items.map(item => `<li>${escape(item)}</li>`).join('') + '</ul>';
    function sourceButtons(ids) {
      return ids.map((id, i) => `<button class="brain-source" data-source="${escape(id)}">근거 ${i + 1} ↗</button>`).join('');
    }
    function bindSources(container) {
      container.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
        const message = workspace.messages.find(m => m.id === button.dataset.source);
        if (message) $('#brainEvidence').textContent = `${message.authorName || '팀원'}: ${message.body}`;
      }));
    }
    function selectConcept(id) {
      selectedId = id;
      const concept = graph?.nodes.find(node => node.id === id);
      $('#brainConceptDetail').innerHTML = concept ? `<h4>${escape(concept.label)}</h4><p>${escape(concept.description)}</p>` + sourceButtons(concept.messageIds) : '';
      bindSources($('#brainConceptDetail'));
      $('#brainMap').querySelectorAll('[data-node]').forEach(el => el.classList.toggle('selected', el.dataset.node === id));
      // Concept selection inspects meaning/evidence; it never becomes a reply tree.
      onSelect(null);
    }
    function drawGraph() {
      if (!summary) {
        $('#brainMap').innerHTML = '<div class="brain-empty">대화를 보내면 AI가 핵심 개념을 합치고<br>개념 사이의 관계를 연결합니다.<br><small>메시지는 채팅에, 요약된 개념은 이 지도에 표시돼요.</small></div>';
        $('#brainNodeCount').textContent = '분석 대기';
        return;
      }
      graph = buildGraph(summary, positions);
      positions = new Map(graph.nodes.map(node => [node.label, { x: node.x, y: node.y }]));
      const byId = new Map(graph.nodes.map(node => [node.id, node]));
      const edges = graph.edges.map((edge, index) => {
        const a = byId.get(edge.source), b = byId.get(edge.target);
        const dx = b.x - a.x, dy = b.y - a.y;
        const ratio = Math.min(88 / Math.max(.1, Math.abs(dx)), 30 / Math.max(.1, Math.abs(dy)), .4);
        const sx = a.x + dx * ratio, sy = a.y + dy * ratio, tx = b.x - dx * ratio, ty = b.y - dy * ratio;
        const bend = index % 2 ? -12 : 12, length = Math.max(1, Math.hypot(dx, dy));
        const mx = (sx + tx) / 2 - dy / length * bend, my = (sy + ty) / 2 + dx / length * bend;
        return `<g class="brain-relation" data-edge="${index}" role="button" tabindex="0" aria-label="${escape(a.label)} ${escape(edge.label)} ${escape(b.label)}"><title>${escape(edge.description)}</title><path class="brain-edge" marker-end="url(#brainArrow)" d="M${sx},${sy} Q${mx},${my} ${tx},${ty}"/><rect class="brain-edge-label-bg" x="${mx - 43}" y="${my - 9}" width="86" height="18" rx="6"/><text class="brain-edge-label" x="${mx}" y="${my + 3}" text-anchor="middle">${escape(clip(edge.label, 12))}</text></g>`;
      }).join('');
      $('#brainMap').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.width * zoom}" height="${graph.height * zoom}" viewBox="0 0 ${graph.width} ${graph.height}" role="group" aria-label="AI가 요약한 개념과 관계의 지식 그래프"><defs><marker id="brainArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#839c68"/></marker></defs>${edges}` + graph.nodes.map(node => `<g class="brain-node brain-kind-${escape(node.kind)}" data-node="${escape(node.id)}" transform="translate(${node.x - 86},${node.y - 29})" role="button" tabindex="0" aria-label="${escape(node.label)}: ${escape(node.description)}"><title>${escape(node.description)}</title><rect width="172" height="58" rx="12"/><text x="13" y="24">${escape(clip(node.label, 14))}</text><text class="brain-author" x="13" y="43">${escape(kinds[node.kind] || '개념')} · 근거 ${node.messageIds.length}개</text></g>`).join('') + '</svg>';
      $('#brainNodeCount').textContent = `${graph.nodes.length}개 개념 · ${graph.edges.length}개 관계`;
      $('#brainMap').querySelectorAll('[data-node]').forEach(el => {
        const choose = () => selectConcept(el.dataset.node);
        el.addEventListener('click', choose);
        el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
      });
      $('#brainMap').querySelectorAll('[data-edge]').forEach(el => {
        const choose = () => {
          const edge = graph.edges[Number(el.dataset.edge)];
          $('#brainConceptDetail').innerHTML = `<h4>${escape(byId.get(edge.source).label)} → ${escape(edge.label)} → ${escape(byId.get(edge.target).label)}</h4><p>${escape(edge.description)}</p>` + sourceButtons(edge.messageIds);
          bindSources($('#brainConceptDetail'));
        };
        el.addEventListener('click', choose);
        el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
      });
      selectConcept(selectedId);
    }
    function renderSummary() {
      $('#brainSummaryContent').innerHTML = `<p>${escape(summary.overview)}</p><h4>더 생각할 질문</h4>${list(summary.questions)}<h4>다음에 해볼 일</h4>${list(summary.nextSteps)}`;
    }
    function schedule() {
      clearTimeout(timer);
      if (!active || busy || automaticBlocked || !ideas().length || fingerprint === analyzedFingerprint) return;
      const delay = Math.max(1800, lastRequestAt + 22000 - Date.now());
      timer = setTimeout(() => { summarize(false); }, delay);
    }
    function beginSession() {
      excludedIds = new Set(workspace.messages.map(message => message.id)); version++;
      fingerprint = ''; analyzedFingerprint = ''; summary = null; graph = null; selectedId = null; positions = new Map();
      automaticBlocked = false; clearTimeout(timer);
      $('#brainConceptDetail').innerHTML = ''; $('#brainEvidence').textContent = '';
      $('#brainSummaryContent').innerHTML = '<p>비슷한 발언을 하나의 개념으로 합치고, 문제·해결책·실행 사이의 관계를 요약해요.</p>';
      status('지금부터의 대화를 AI가 개념과 관계로 정리해요.');
      onSelect(null);
    }
    async function setActive(value) {
      if (starting) return;
      if (value && !workspace) { onError('팀 정보를 불러온 뒤 다시 눌러 주세요.'); return; }
      if (value && onStart) {
        const requestedKey = key(); starting = true; $('#brainstormToggle').disabled = true;
        try { const latest = await onStart(workspace.team.id); if (key() !== requestedKey) return; workspace = latest; }
        catch (error) { onError(error.message); return; }
        finally { starting = false; $('#brainstormToggle').disabled = false; }
      }
      if (value) beginSession(); else { version++; clearTimeout(timer); }
      active = value;
      $('#brainstormPanel').hidden = !active;
      $('#brainstormToggle').setAttribute('aria-pressed', String(active));
      $('#chat').classList.toggle('brain-active', active);
      $('#messageInput').placeholder = active ? '아이디어를 자유롭게 보내세요. AI가 개념과 관계를 연결해요…' : '팀의 생각을 이어주세요...';
      $('#brainReply').hidden = true; onSelect(null);
      if (active) drawGraph();
    }
    async function summarize(manual = true) {
      if (!active || !workspace || !channelId || busy) return;
      const rows = ideas();
      if (!rows.length) { if (manual) onError('아이디어를 먼저 보내 주세요.'); return; }
      if (manual) automaticBlocked = false;
      if (Date.now() < lastRequestAt + 22000) { status('새 아이디어를 모으고 있어요. 잠시 후 자동으로 연결합니다.'); schedule(); return; }
      clearTimeout(timer); busy = true; lastRequestAt = Date.now();
      const requestedKey = key(), requestedFingerprint = fingerprint, requestedVersion = version;
      $('#brainSummaryButton').disabled = true;
        status('AI가 유사한 개념을 합치고 의미 관계를 연결하고 있어요…');
      try {
        const result = await onSummary({ teamId: workspace.team.id, channelId, messageIds: rows.map(row => row.id) });
        if (!active || key() !== requestedKey || version !== requestedVersion) return;
        summary = result.summary; analyzedFingerprint = requestedFingerprint;
        drawGraph(); renderSummary();
        status(fingerprint === analyzedFingerprint ? 'AI가 요약한 지식 그래프 · 노드와 관계를 눌러 근거를 확인하세요.' : '새 대화가 있어요. 의미 관계를 다시 분석할 예정이에요.');
      } catch (error) {
        if (active && key() === requestedKey && version === requestedVersion) {
          status(error.message); automaticBlocked = true;
          if (!summary) $('#brainMap').innerHTML = '<div class="brain-empty">AI 연결을 확인해 주세요.<br>연결되면 대화를 개념과 관계로 요약해 표시합니다.</div>';
        }
      } finally { busy = false; $('#brainSummaryButton').disabled = false; schedule(); }
    }
    function update(next, channel) {
      workspace = next; channelId = channel;
      if (contextKey !== key()) { contextKey = key(); if (active) beginSession(); }
      if (!active) return;
      const nextFingerprint = key() + JSON.stringify(ideas().map(message => [message.id, message.body]));
      if (nextFingerprint !== fingerprint) {
        fingerprint = nextFingerprint;
        if (ideas().length && !automaticBlocked) status(summary ? '새 대화의 의미 관계를 연결할 예정이에요.' : '새 대화를 받았어요. 개념을 추출할 예정이에요.');
        if (!summary) drawGraph();
        schedule();
      }
    }
    $('#brainstormToggle').addEventListener('click', () => setActive(!active));
    $('#brainSummaryButton').addEventListener('click', () => summarize(true));
    $('#brainReplyClear').addEventListener('click', () => onSelect(null));
    function resize(delta, reset = false) {
      zoom = reset ? 1 : Math.max(.4, Math.min(1.8, zoom + delta));
      const svg = $('#brainMap').querySelector('svg');
      if (svg && graph) { svg.setAttribute('width', graph.width * zoom); svg.setAttribute('height', graph.height * zoom); }
    }
    $('#brainZoomIn').addEventListener('click', () => resize(.2));
    $('#brainZoomOut').addEventListener('click', () => resize(-.2));
    $('#brainReset').addEventListener('click', () => resize(0, true));
    return { update };
  }
  globalThis.BrainstormGraph = { buildGraph, create };
})();
