const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('public/brainstorm.js', 'utf8');
const concept = (id, label, messageIds = ['new-1']) => ({ id, label, kind: 'idea', description: `${label}의 의미`, messageIds });
const semantic = ids => ({ overview: '관련 발언을 하나로 묶은 요약', concepts: [concept('merged-concept', '학생 인증', ids)], relations: [], questions: [], nextSteps: [] });
const message = id => ({ id, channelId: 'channel', authorType: 'user', body: `원문-${id}` });
test('lays out a semantic graph with cross-links and cycles rather than message parents', () => {
  const scope = {}; vm.runInNewContext(source, scope);
  const graph = scope.BrainstormGraph.buildGraph({ concepts: [concept('a', '중고 장터'), concept('b', '학생 인증'), concept('c', '안전 거래')], relations: [
    { source: 'a', target: 'b', label: '필요하다' }, { source: 'b', target: 'c', label: '보장한다' },
    { source: 'a', target: 'c', label: '목표로 한다' }, { source: 'c', target: 'a', label: '활성화한다' },
  ] });
  assert.equal(graph.nodes.length, 3); assert.equal(graph.edges.length, 4);
  assert.equal(graph.edges.filter(edge => edge.target === 'c').length, 2);
  for (const node of graph.nodes) { assert(Number.isFinite(node.x)); assert(Number.isFinite(node.y)); }
});
function sessionUI(onSummary, onStart) {
  const nodes = new Map(), timers = new Map(); let timerId = 0;
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', hidden: false, events: {}, classList: { toggle() {} }, setAttribute() {}, querySelectorAll: () => [], addEventListener(name, fn) { this.events[name] = fn; } });
    return nodes.get(selector);
  };
  const scope = { document: { querySelector: element }, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(source, scope);
  const ui = scope.BrainstormGraph.create({ onSelect() {}, onSummary: onSummary || (async data => ({ summary: semantic(data.messageIds) })), onError() {}, onStart });
  const workspace = messages => ({ team: { id: 'team' }, messages, channels: [{ id: 'channel', name: '주제' }] });
  return { ui, element, workspace, timers, click: selector => element(selector).events.click() };
}
test('excludes old chat and renders only AI concepts, merging multiple new messages', async () => {
  let request;
  const c = sessionUI(async input => { request = input; return { summary: semantic(input.messageIds) }; });
  c.ui.update(c.workspace([message('old')]), 'channel'); await c.click('#brainstormToggle');
  c.ui.update(c.workspace([message('old'), message('new-1'), message('new-2')]), 'channel');
  assert(!c.element('#brainMap').innerHTML.includes('data-node="new-1"'));
  await c.click('#brainSummaryButton');
  assert.deepEqual(Array.from(request.messageIds), ['new-1', 'new-2']);
  assert.equal(c.element('#brainNodeCount').textContent, '1개 개념 · 0개 관계');
  assert(c.element('#brainMap').innerHTML.includes('학생 인증'));
  assert(!c.element('#brainMap').innerHTML.includes('원문-new-1'));
  await c.click('#brainstormToggle');
  c.ui.update(c.workspace([message('old'), message('new-1'), message('new-2'), message('while-off')]), 'channel');
  await c.click('#brainstormToggle');
  assert.equal(c.element('#brainNodeCount').textContent, '분석 대기');
});
test('new chat schedules automatic semantic analysis', async () => {
  let calls = 0;
  const c = sessionUI(async data => { calls++; return { summary: semantic(data.messageIds) }; });
  c.ui.update(c.workspace([]), 'channel'); await c.click('#brainstormToggle');
  c.ui.update(c.workspace([message('new-1')]), 'channel');
  assert.equal(c.timers.size, 1);
  const task = [...c.timers.values()][0]; task();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert(c.element('#brainMap').innerHTML.includes('data-node="merged-concept"'));
});
test('a pending AI graph never overwrites a new session', async () => {
  let finish;
  const c = sessionUI(() => new Promise(resolve => { finish = resolve; }));
  c.ui.update(c.workspace([]), 'channel'); await c.click('#brainstormToggle');
  c.ui.update(c.workspace([message('new-1')]), 'channel');
  const pending = c.click('#brainSummaryButton');
  await c.click('#brainstormToggle'); await c.click('#brainstormToggle');
  finish({ summary: semantic(['new-1']) }); await pending;
  assert(!c.element('#brainMap').innerHTML.includes('merged-concept'));
});
test('AI failures keep a truthful empty state and stop automatic retries', async () => {
  const c = sessionUI(async () => { throw new Error('AI 미연결'); });
  c.ui.update(c.workspace([]), 'channel'); await c.click('#brainstormToggle');
  c.ui.update(c.workspace([message('new-1')]), 'channel');
  await c.click('#brainSummaryButton');
  assert.equal(c.element('#brainSummaryStatus').textContent, 'AI 미연결');
  assert(!c.element('#brainMap').innerHTML.includes('data-node='));
  assert.equal(c.timers.size, 0);
});
