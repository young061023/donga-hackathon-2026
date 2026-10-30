import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBrainstorm, validateKnowledgeGraph } from '../lib/brainstorm-ai.ts';
const summary = { overview: '아이디어 요약', concepts: [
  { id: 'market', label: '학생 중고 장터', description: '팀의 서비스 아이디어', kind: 'topic', messageIds: ['msg-1'] },
  { id: 'trust', label: '학교 인증', description: '학교 인증으로 신뢰 확보', kind: 'solution', messageIds: ['msg-1'] },
], relations: [{ source: 'market', target: 'trust', label: '필요하다', description: '안전한 거래를 위한 인증 제안', messageIds: ['msg-1'] }], questions: ['누가 사용할까요?'], nextSteps: ['작게 검증하기'] };
const response = value => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
test('uses Gemini server authentication and requests a structured knowledge graph', async () => {
  const result = await summarizeBrainstorm({ messages: ['idea'] }, 'test-key', 'test-model', new Set(['msg-1']), async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
    assert.equal(body.generationConfig.responseFormat.text.schema.type, 'object');
    assert.equal(body.contents[0].role, 'user');
    assert.match(body.systemInstruction.parts[0].text, /핵심 개념/);
    assert(!url.includes('test-key'));
    assert(!options.body.includes('test-key'));
    return response(summary);
  });
  assert.deepEqual(result, summary);
});
test('rejects invented source message IDs', async () => {
  await assert.rejects(summarizeBrainstorm({}, 'test-key', 'model', new Set(), async () => response(summary)), /AI_INVALID_REFERENCES/);
});
test('handles provider failures and incomplete responses', async () => {
  await assert.rejects(summarizeBrainstorm({}, 'test-key', 'model', new Set(), async () => new Response('', { status: 429 })), /AI_PROVIDER_ERROR/);
  await assert.rejects(summarizeBrainstorm({}, 'test-key', 'model', new Set(), async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] })), /AI_INCOMPLETE/);
});

test('rejects dangling relations, duplicate concepts and disconnected graph', () => {
  const allowed = new Set(['msg-1']);
  assert.throws(() => validateKnowledgeGraph({ ...summary, relations: [{ ...summary.relations[0], target: 'made-up' }] }, allowed), /AI_INVALID_RELATIONS/);
  assert.throws(() => validateKnowledgeGraph({ ...summary, concepts: [summary.concepts[0], summary.concepts[0]] }, allowed), /AI_DUPLICATE_CONCEPTS/);
  assert.throws(() => validateKnowledgeGraph({ ...summary, relations: [] }, allowed), /AI_DISCONNECTED_GRAPH/);
});
test('allows one concept to merge multiple messages and have multiple incoming relations', () => {
  const value = { ...summary, concepts: [...summary.concepts, { ...summary.concepts[1], id: 'safe', label: '안전 거래', messageIds: ['msg-1', 'msg-2'] }], relations: [...summary.relations,
    { ...summary.relations[0], source: 'market', target: 'safe', label: '목표로 한다' },
    { ...summary.relations[0], source: 'trust', target: 'safe', label: '가능하게 한다', messageIds: ['msg-2'] },
  ] };
  const graph = validateKnowledgeGraph(value, new Set(['msg-1', 'msg-2']));
  assert.equal(graph.concepts[2].messageIds.length, 2);
  assert.equal(graph.relations.filter(edge => edge.target === 'safe').length, 2);
});

test('rejects blocked Gemini prompts and ignores thought parts', async () => {
  await assert.rejects(summarizeBrainstorm({}, 'test-key', 'model', new Set(), async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } })), /AI_BLOCKED/);
  const result = await summarizeBrainstorm({}, 'test-key', 'model', new Set(['msg-1']), async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private reasoning' }, { text: JSON.stringify(summary) }] } }] }));
  assert.deepEqual(result, summary);
});
test('rejects invalid model paths before sending credentials', async () => {
  await assert.rejects(summarizeBrainstorm({}, 'test-key', '../invalid?key=x', new Set(), async () => { throw new Error('should not fetch'); }), /AI_INVALID_MODEL/);
});
