#!/usr/bin/env node
/**
 * 대학지원사업 데이터 건전성 점검.
 *
 *   node scripts/verify-univfund.mjs            # 링크 + 검증일 + 데이터 정합성
 *   node scripts/verify-univfund.mjs --no-net   # 네트워크 없이 데이터만
 *   node scripts/verify-univfund.mjs --stale 6  # 검증일 경과 기준(개월), 기본 6
 *
 * 링크는 조용히 썩는다. RSS 피드에서 죽은 링크 3개를 찾아낸 것과 같은 이유로,
 * sourceUrl과 detail.links를 주기적으로 두드려 봐야 한다.
 *
 * 종료 코드: 0 = 문제 없음, 1 = 하나라도 실패/경고
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = join(HERE, '..', 'startpage', 'index.html');

const args = process.argv.slice(2);
const NO_NET = args.includes('--no-net');
const STALE_MONTHS = Number(args[args.indexOf('--stale') + 1]) || 6;
const CONCURRENCY = 6;
const TIMEOUT_MS = 12000;

const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

/** index.html에서 UNIV_FUND_PROGRAMS 배열을 꺼내 평가한다. */
function loadPrograms() {
  const html = readFileSync(HTML, 'utf8');
  const start = html.indexOf('const UNIV_FUND_PROGRAMS = [');
  if (start < 0) throw new Error('UNIV_FUND_PROGRAMS를 찾지 못했습니다');
  // 배열 리터럴의 끝을 대괄호 균형으로 찾는다(문자열 안의 괄호는 무시).
  const from = html.indexOf('[', start);
  let depth = 0, i = from, inStr = null, end = -1;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('배열의 끝을 찾지 못했습니다');
  return new Function(`return ${html.slice(from, end)};`)();
}

/**
 * HEAD가 실패하면 반드시 GET으로 재시도한다.
 * 한국 언론사 CMS(news.unn.net 등)는 HEAD에 404를 주면서 GET에는 200을 준다.
 * HEAD만 믿으면 살아 있는 링크를 죽었다고 보고한다.
 */
async function probe(url) {
  const t0 = Date.now();
  const opts = {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,*/*',
    },
  };
  let headStatus = null;
  try {
    const r = await fetch(url, { ...opts, method: 'HEAD' });
    if (r.ok) return { ok: true, status: r.status, ms: Date.now() - t0, via: 'HEAD' };
    headStatus = r.status;
  } catch (_) { /* GET으로 넘어간다 */ }

  try {
    const r = await fetch(url, { ...opts, method: 'GET' });
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, via: 'GET', headStatus };
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message);
    return { ok: false, status: headStatus || 0, ms: Date.now() - t0, error: why };
  }
}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

const monthsSince = iso => (Date.now() - new Date(iso)) / 86400000 / 30.44;

// ── 실행 ──
const programs = loadPrograms();
console.log(c.bold(`\n대학지원사업 ${programs.length}개 점검\n`));

let problems = 0;

// 1) 데이터 정합성
const REQUIRED = ['id', 'cat', 'name', 'target', 'budget', 'selected', 'agency', 'confidence', 'sourceUrl'];
const CONF = ['확인', '부분확인', '미확인'];
const dataIssues = [];
const seen = new Set();

for (const p of programs) {
  const tag = p.id || '(id 없음)';
  for (const f of REQUIRED) if (!p[f]) dataIssues.push(`${tag}: 필수 필드 '${f}' 누락`);
  if (seen.has(p.id)) dataIssues.push(`${tag}: id 중복`);
  seen.add(p.id);

  for (const f of ['confidence', 'budgetConf', 'selectedConf']) {
    if (p[f] && !CONF.includes(p[f])) dataIssues.push(`${tag}: ${f} 값이 이상함 → '${p[f]}'`);
  }
  if (!p.verifiedAt) dataIssues.push(`${tag}: verifiedAt 없음`);
  else if (isNaN(new Date(p.verifiedAt))) dataIssues.push(`${tag}: verifiedAt 파싱 불가 → '${p.verifiedAt}'`);

  // "확인"인데 값이 미확인이면 뱃지가 거짓말을 한다
  if (p.budgetConf === '확인' && /미확인/.test(p.budget)) dataIssues.push(`${tag}: budgetConf=확인 인데 budget이 '미확인'`);
  if (p.selectedConf === '확인' && /미확인/.test(p.selected)) dataIssues.push(`${tag}: selectedConf=확인 인데 selected가 '미확인'`);

  if (!Array.isArray(p.schedule) || !p.schedule.length) dataIssues.push(`${tag}: schedule 비어 있음`);
  if (!p.detail) dataIssues.push(`${tag}: detail 없음 (상세 팝업이 빈약해집니다)`);
}

console.log(c.bold('■ 데이터 정합성'));
if (dataIssues.length) {
  problems += dataIssues.length;
  dataIssues.forEach(m => console.log('  ' + c.red('✗') + ' ' + m));
} else {
  console.log('  ' + c.green('✓') + ' 이상 없음');
}

// 2) 검증일 경과
console.log('\n' + c.bold(`■ 검증 신선도 (기준 ${STALE_MONTHS}개월)`));
const stale = programs
  .filter(p => p.verifiedAt && !isNaN(new Date(p.verifiedAt)))
  .map(p => ({ p, m: monthsSince(p.verifiedAt) }))
  .filter(x => x.m >= STALE_MONTHS)
  .sort((a, b) => b.m - a.m);

if (stale.length) {
  problems += stale.length;
  stale.forEach(({ p, m }) => {
    const mark = m >= 12 ? c.red('✗') : c.yellow('!');
    console.log(`  ${mark} ${p.name} — ${p.verifiedAt} (${m.toFixed(1)}개월 경과)`);
  });
} else {
  console.log('  ' + c.green('✓') + ' 모두 최신');
}

// 3) 링크 생존
if (NO_NET) {
  console.log('\n' + c.dim('■ 링크 점검 건너뜀 (--no-net)'));
} else {
  const urls = [];
  for (const p of programs) {
    if (p.sourceUrl) urls.push({ p, url: p.sourceUrl, kind: 'sourceUrl' });
    for (const l of p.detail?.links || []) if (l.url) urls.push({ p, url: l.url, kind: `link:${l.name}` });
  }
  const uniq = [...new Map(urls.map(u => [u.url, u])).values()];
  console.log('\n' + c.bold(`■ 링크 점검 (${uniq.length}개 · 동시 ${CONCURRENCY})`));

  const results = await pool(uniq.map(u => async () => ({ ...u, r: await probe(u.url) })), CONCURRENCY);
  const dead = results.filter(x => !x.r.ok);

  if (dead.length) {
    problems += dead.length;
    dead.forEach(({ p, url, kind, r }) => {
      const why = r.error ? r.error : `HTTP ${r.status}`;
      console.log(`  ${c.red('✗')} ${p.id} [${kind}] ${c.dim(why)}\n     ${url}`);
    });
  }
  const slow = results.filter(x => x.r.ok && x.r.ms > 5000);
  slow.forEach(({ p, url, r }) => console.log(`  ${c.yellow('!')} ${p.id} 응답 느림 ${r.ms}ms — ${url}`));

  const headLies = results.filter(x => x.r.ok && x.r.headStatus).length;
  if (headLies) console.log(c.dim(`  · ${headLies}개는 HEAD가 실패했지만 GET은 정상 (언론사 CMS의 흔한 동작)`));
  console.log(`  ${c.green('✓')} 정상 ${results.length - dead.length}/${results.length}`);
}

console.log('\n' + (problems
  ? c.red(c.bold(`문제 ${problems}건`))
  : c.green(c.bold('문제 없음'))) + '\n');
process.exit(problems ? 1 : 0);
