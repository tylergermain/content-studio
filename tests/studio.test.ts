// A floor made its own (shared/studio.ts, server/studio.ts): its boards, what's posted on them, its
// kiosk agents, and the command its workers post with (bin/office-board.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Studio } from '../src/server/studio.js';
import { LIMITS, boardNamed, cleanPost, cleanSetup, cleanSymbol, cleanUrl, postingBrief, unseen } from '../src/shared/studio.js';
// @ts-expect-error a plain .js command, with no types of its own
import { UsageError, buildRequest, formatBoards, parseArgs } from '../bin/office-board.js';

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-studio-studio-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SETUP = {
  boards: { issues: { title: 'Newsroom', icon: '📰', about: 'AI news worth making content about.' }, pulls: { title: 'Team Slack', icon: '💬', about: '', feed: { kind: 'slack', channels: [{ id: 'C0123ABCDE', name: '#general' }, { id: 'nope', name: 'x' }] } } },
  agents: { issues: { name: 'News agent', offer: 'Ask me for today’s news', brief: 'You find the news.\nVerify it.' }, queue: { name: '', brief: 'nameless' } },
  ticker: { symbols: ['aapl', 'BTC-USD', '^gspc', 'not a symbol', 'AAPL'] },
};

test('a setup keeps what is valid: named boards and agents, real channels, real symbols', () => {
  const s = cleanSetup(SETUP);
  assert.deepEqual(Object.keys(s.boards), ['issues', 'pulls']);
  assert.deepEqual(s.boards.pulls!.feed, { kind: 'slack', channels: [{ id: 'C0123ABCDE', name: 'general' }] });
  assert.equal(s.boards.issues!.feed, undefined);
  // An agent with no name isn't one; a brief keeps its lines.
  assert.deepEqual(Object.keys(s.agents), ['issues']);
  assert.equal(s.agents.issues!.brief, 'You find the news.\nVerify it.');
  assert.deepEqual(s.ticker, { symbols: ['AAPL', 'BTC-USD', '^GSPC'] });
  // Nothing at all is the floor as it comes.
  assert.deepEqual(cleanSetup('junk'), { boards: {}, agents: {} });
  assert.deepEqual(cleanSetup({ boards: { issues: { title: '   ' } }, ticker: { symbols: [] } }), { boards: {}, agents: {} });
  assert.equal(cleanSymbol('BRK.B'), 'BRK.B');
  assert.equal(cleanSymbol('rm -rf'), undefined);
  assert.equal(cleanUrl('javascript:alert(1)'), undefined);
  assert.equal(cleanUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
});

test('a post needs a board and a title, and a link that is a link', () => {
  assert.equal(typeof cleanPost({ title: 'x' }), 'string');
  assert.equal(typeof cleanPost({ board: 'issues', title: '  ' }), 'string');
  assert.equal(typeof cleanPost({ board: 'issues', title: 'x', url: 'ftp://nope' }), 'string');
  assert.deepEqual(cleanPost({ board: 'issues', title: ' A   headline\n ', url: 'https://a.example', source: 'The Paper', body: 'one\r\ntwo', extra: 1 }), { board: 'issues', title: 'A headline', body: 'one\ntwo', url: 'https://a.example', source: 'The Paper' });
  const long = cleanPost({ board: 'pulls', title: 'x'.repeat(500) });
  assert.ok(typeof long === 'object' && long.title.length === LIMITS.title);
});

test('a floor keeps its boards and their posts across restarts, newest first, once each', () => {
  withDir((dir) => {
    const studio = new Studio(dir);
    assert.equal(typeof studio.post({ board: 'issues', title: 'Too early' }, 'Ada'), 'string', 'no such board yet');
    studio.configure(SETUP);
    const a = studio.post({ board: 'issues', title: 'First story', url: 'https://a.example/1' }, 'News agent');
    const b = studio.post({ board: 'issues', title: 'Second story' }, 'Ada');
    assert.ok(typeof a === 'object' && typeof b === 'object');
    assert.match(studio.post({ board: 'issues', title: 'first STORY' }, 'Bo') as string, /already on the board/);
    assert.match(studio.post({ board: 'issues', title: 'Same link', url: 'https://a.example/1' }, 'Bo') as string, /already on the board/);
    assert.match(studio.post({ board: 'pulls', title: 'By hand' }, 'Bo') as string, /fills that board by itself/);
    assert.deepEqual(studio.state().posts.map((p) => p.title), ['Second story', 'First story']);

    // What's gone up since someone last looked is new.
    assert.equal(unseen(studio.state(), 'issues'), 2);
    assert.equal(studio.look('issues'), true);
    assert.equal(unseen(studio.state(), 'issues'), 0);
    assert.equal(studio.look('nowhere'), false);

    const again = new Studio(dir);
    assert.deepEqual(again.state().posts.map((p) => [p.title, p.by]), [['Second story', 'Ada'], ['First story', 'News agent']]);
    assert.equal(again.agentName('issues'), 'News agent');
    assert.equal(again.agentName('pulls'), undefined);
    assert.deepEqual(again.symbols(), ['AAPL', 'BTC-USD', '^GSPC']);
    assert.equal(typeof again.remove(a.id), 'object');
    assert.equal(again.remove('nope'), 'No such post');

    // A board the office fills: what it reads takes the place of what was there.
    assert.equal(again.fill('pulls', [{ id: 's1', title: 'hello', source: '#general', by: 'Cy', at: 5 }]), true);
    assert.equal(again.fill('pulls', [{ id: 's1', title: 'hello', source: '#general', by: 'Cy', at: 5 }]), false, 'nothing new');
    // A board that's no longer the floor's takes its posts with it.
    again.configure({ boards: { issues: SETUP.boards.issues } });
    assert.deepEqual(again.state().posts.map((p) => p.board), ['issues']);
  });
});

test('a floor briefs its own agents, with how to post to its boards', () => {
  withDir((dir) => {
    const studio = new Studio(dir);
    assert.equal(studio.brief('issues', 'Content'), undefined, 'the office\'s own brief, until the floor has one');
    studio.configure(SETUP);
    const brief = studio.brief('issues', 'Content')!;
    assert.match(brief, /^You're the News agent on the Content floor/);
    assert.match(brief, /You find the news\.\nVerify it\./);
    assert.match(brief, /office-board post --board "Title"/);
    assert.match(brief, /"Newsroom": AI news worth making content about\./);
    assert.match(brief, /The request:$/);
    assert.equal(studio.brief('pulls', 'Content'), undefined);
    assert.equal(postingBrief(cleanSetup({})), '');
    const setup = studio.state().setup;
    assert.equal(boardNamed(setup, 'newsroom'), 'issues');
    assert.equal(boardNamed(setup, 'pulls'), 'pulls');
    assert.equal(boardNamed(setup, ''), 'issues', 'the first board, when none is named');
    assert.equal(boardNamed(setup, 'gossip'), undefined);
  });
});

test('office-board: its command line, and what it asks the office', () => {
  assert.deepEqual(parseArgs([]), { cmd: 'help' });
  assert.deepEqual(parseArgs(['list', '--board', 'Newsroom']), { cmd: 'list', board: 'Newsroom' });
  assert.deepEqual(parseArgs(['post', '--title', ' A story ', '--url=https://a.example', '--source', 'The Paper']), { cmd: 'post', title: 'A story', url: 'https://a.example', source: 'The Paper' });
  assert.deepEqual(parseArgs(['rm', 'ab12']), { cmd: 'remove', id: 'ab12' });
  assert.throws(() => parseArgs(['post', '--url', 'https://a.example']), UsageError);
  assert.throws(() => parseArgs(['post', 'loose words']), UsageError);
  assert.throws(() => parseArgs(['list', '--title', 'x']), UsageError);
  assert.throws(() => parseArgs(['launch']), UsageError);

  const office = { url: 'http://127.0.0.1:5000', worker: 'w1', token: 'secret' };
  const post = buildRequest(parseArgs(['post', '--board', 'Newsroom', '--title', 'A story']), office, 'what it is\r\nabout\n');
  assert.equal(post.method, 'POST');
  assert.equal(post.url, 'http://127.0.0.1:5000/office/board?worker=w1');
  assert.equal(post.headers.authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(post.body), { title: 'A story', board: 'Newsroom', body: 'what it is\nabout' });
  assert.equal(buildRequest(parseArgs(['list', '--board', 'Newsroom']), office).url, 'http://127.0.0.1:5000/office/board?worker=w1&board=Newsroom');
  assert.equal(buildRequest(parseArgs(['remove', 'ab12']), office).method, 'DELETE');
  assert.match(formatBoards({ boards: [{ title: 'Newsroom', about: 'News.', posts: [{ id: 'ab12', title: 'A story', source: 'The Paper', by: 'News agent' }] }, { title: 'Slack', filled: true, posts: [] }] }), /Newsroom: News\.\n {2}ab12 {2}A story · The Paper · by News agent\nSlack \(the office fills this one itself\)\n {2}\(nothing posted\)/);
  assert.equal(formatBoards({}), 'This floor has no bulletin boards.');
});
