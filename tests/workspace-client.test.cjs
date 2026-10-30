const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function client(search = '', storedTeam = null) {
  const nodes = new Map();
  const storage = new Map(storedTeam ? [['moa-team:user-1', storedTeam]] : []);
  const calls = [], intervals = [];
  let incoming = [];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, querySelectorAll: () => [] });
    return nodes.get(selector);
  };
  const context = {
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {}, hidden: false },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location: { search, pathname: '/app.html' }, history: { replaceState() {} },
    URLSearchParams, FormData, Intl, setTimeout() {}, clearTimeout() {},
    setInterval(fn, delay) { intervals.push({ fn, delay }); },
    async fetch(path) {
      calls.push(path);
      const team = path.includes('teamId=') ? new URL(path, 'http://localhost').searchParams.get('teamId') : 'old-team';
      return { ok: true, json: async () => path === '/api/join' ? { team: { id: 'invited-team' } } : {
        currentUser: { id: 'user-1', displayName: '팀원' }, team: { id: team, name: team },
        members: [], channels: [{ id: 'channel-1', name: '대화' }], messages: incoming,
        tasks: [], polls: [], workStatuses: [],
      }};
    },
  };
  const source = fs.readFileSync('public/client.js', 'utf8').replace('  start();', '  globalThis.start = start;');
  vm.runInNewContext(source, context);
  return { context, calls, storage, intervals, nodes, setMessages: messages => { incoming = messages; } };
}

test('invitation selects joined team, persists it, and polls incoming messages', async () => {
  const c = client('?join=code', 'old-team');
  await c.context.start();
  assert.equal(c.calls[1], '/api/workspace?teamId=invited-team');
  assert.equal(c.storage.get('moa-team:user-1'), 'invited-team');
  assert.equal(c.intervals[0].delay, 2000);
  c.setMessages([{ id: 'msg-1', channelId: 'channel-1', authorId: 'user-2', authorName: '동료', body: '함께 보이는 메시지' }]);
  c.intervals[0].fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(c.nodes.get('#messageList').innerHTML, /함께 보이는 메시지/);
});

test('reload restores the current account’s selected team', async () => {
  const c = client('', 'invited-team');
  await c.context.start();
  assert.deepEqual(c.calls, ['/api/workspace', '/api/workspace?teamId=invited-team']);
});
