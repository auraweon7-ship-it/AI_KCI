// 코퍼스 -> 작품/문장 JSON 생성기
// 핵심 필드(원문·풀이·출전)는 큐레이션, 부가 필드는 사전+규칙 자동 생성.
const fs = require('fs');
const DICT = Object.assign({}, require('./dict.js'), require('./dict2.js'), require('./dict3.js'));

// 문맥 다음자 오버라이드(앞 글자 기준 등은 단순화: 글자별 대표 독음 사용)
const lines = fs.readFileSync('/tmp/gen/final.txt','utf8').split('\n')
  .map(l=>l.trim()).filter(l=>l && !l.startsWith('#'));

// 한자만 추출
const isHan = ch => /[㐀-鿿豈-﫿]/.test(ch);

// 허사(문법 기능어) 목록 — 문법 포인트 자동 부여용
const FUNCTION_WORDS = {
  "之":"관형격/대명사 '之'","而":"접속사 '而'(순접·역접)","則":"조건 '則'(~하면)",
  "於":"전치사 '於'(~에/~에서/피동)","于":"전치사 '于'(~에)","以":"전치사 '以'(~로써)",
  "者":"'者'(~하는 것/사람)","也":"종결사 '也'(단정)","矣":"종결사 '矣'(완료)",
  "乎":"종결사 '乎'(의문·반어)","哉":"종결사 '哉'(감탄·반어)","焉":"'焉'(어찌/이에)",
  "不":"부정 '不'","非":"부정 '非'(~아니다)","無":"부정 '無'(없다)","莫":"금지·부정 '莫'",
  "勿":"금지 '勿'(~말라)","未":"'未'(아직 ~못하다)","若":"가정·비교 '若'(만약/같다)",
  "如":"'如'(같다/만약)","雖":"양보 '雖'(비록)","其":"지시 '其'(그)","是":"지시·판단 '是'(이/옳다)",
  "爲":"'爲'(하다/되다/위하여)","所":"'所'+동사(~하는 바)","可":"가능 '可'(~할 수 있다)",
  "必":"부사 '必'(반드시)","自":"'自'(스스로/~로부터)","與":"'與'(~와/더불어/주다)",
};

// 다음자(多音字) 처리: 일부 글자는 의미별 독음을 코퍼스 문맥에 맞게 우선순위 적용은 생략하고
// 대표 독음을 쓰되, 잘 알려진 케이스만 보정.
function readingOf(ch){
  const e = DICT[ch];
  if(e) return e[0];
  return '·'; // 사전에 없으면 placeholder
}
function meaningOf(ch){
  const e = DICT[ch];
  return e ? e[1] : '';
}

// 원문 -> 독음 문자열
function toReading(text){
  let out = [];
  for(const ch of text){
    if(isHan(ch)) out.push(readingOf(ch));
    else if(ch.trim()==='') out.push(' ');
  }
  // 공백 정리
  return out.join('').replace(/·/g,'').trim() || text;
}

// 핵심 어휘 추출: 허사가 아닌 실사 위주로 최대 4개
function keywordsOf(chars){
  const ks = [];
  const seen = new Set();
  for(const ch of chars){
    if(seen.has(ch)) continue;
    seen.add(ch);
    const m = meaningOf(ch);
    if(!m) continue;
    // 실사 우선(허사는 뒤로)
    ks.push({ word:ch, reading:readingOf(ch), meaning:m, note: FUNCTION_WORDS[ch]?'문법 기능어':'', isFn: !!FUNCTION_WORDS[ch] });
  }
  // 실사 우선 정렬 후 최대 4
  ks.sort((a,b)=>a.isFn - b.isFn);
  return ks.slice(0,4).map(({word,reading,meaning,note})=>({word,reading,meaning,note}));
}

// 문법 포인트: 문장에 포함된 허사 기반 1~2개
function grammarOf(chars){
  const pts = [];
  const seen = new Set();
  for(const ch of chars){
    if(FUNCTION_WORDS[ch] && !seen.has(ch)){
      seen.add(ch);
      pts.push({ point: ch+' 용법', explanation: FUNCTION_WORDS[ch], example: '' });
    }
    if(pts.length>=2) break;
  }
  if(!pts.length){
    pts.push({ point:'한문 어순', explanation:'주어+서술어+목적어/보어의 기본 어순으로 풀이한다.', example:'' });
  }
  return pts;
}

// 문장 구조(간이): 첫 실사를 주어, 동사류를 서술어로 추정
function structureOf(chars){
  const hanChars = chars.filter(isHan);
  return {
    subject: hanChars[0] || '-',
    predicate: hanChars.find(c=>{ const m=meaningOf(c); return /다$/.test(m)||/하다|되다/.test(m); }) || (hanChars[1]||'-'),
    object: hanChars[hanChars.length-1] || '-',
    omitted: hanChars.length<=4 ? '문맥상 일부 성분 생략 가능' : '-'
  };
}

/* ============================================================
   『공식으로 읽는 논어명구』(박정원) 분석 틀 자동 적용
   - 문장성분 표기: S(주어)/V(술어)/O(목적어)/E(생략, empty)
   - 사건의미: 변화결과(BECOME)/상태(BE)/활동(DO)
   - 논리관계: 순접/역접 (접속사 기반)
   - 백화(白话): 규칙 기반 현대중국어 근사 풀이
   ============================================================ */

// 동사/술어 후보 판정
function isVerb(ch){ const m=meaningOf(ch); return m && (/다$/.test(m) && !/[가-힣]+다$/.test('명사')) ; }
function isPredicate(ch){ const m=meaningOf(ch); return m && /(다|하다|되다|이다)$/.test(m); }

// 허사(생략·표기 제외 대상)
const PARTICLES = new Set(['之','而','則','於','于','以','也','矣','乎','哉','焉','者','其','且','兮','夫','蓋','故']);
// 부정·금지 부사(술어 후보에서 제외 — 뒤의 본동사가 V)
const NEGATIVES = new Set(['不','非','無','莫','勿','未','弗','否']);

// 한 절(comma 단위)에 S/V/O/E 태그를 부여하여 표기 문자열 생성
function tagClause(clause){
  const chars=[...clause].filter(isHan);
  if(!chars.length) return {marked:'', s:'-', v:'-', o:'-', hasE:false};
  // 술어(V): 동사류 중 가장 앞쪽(부정사 제외, 한문 SVO 기본 어순)
  let vIdx=-1;
  for(let i=0;i<chars.length;i++){ if(isPredicate(chars[i]) && !NEGATIVES.has(chars[i])){ vIdx=i; break; } }
  if(vIdx<0){ // 동사 없으면 마지막 실사를 서술(계사 생략 판단)
    for(let i=chars.length-1;i>=0;i--){ if(!PARTICLES.has(chars[i]) && !NEGATIVES.has(chars[i])){ vIdx=i; break; } }
  }
  // 주어(S): V 앞의 첫 실사(부정사·허사 제외)
  let sIdx=-1;
  for(let i=0;i<vIdx;i++){ if(!PARTICLES.has(chars[i]) && !NEGATIVES.has(chars[i])){ sIdx=i; break; } }
  // 목적어(O): V 뒤의 첫 실사(부정사·허사 제외)
  let oIdx=-1;
  for(let i=vIdx+1;i<chars.length;i++){ if(!PARTICLES.has(chars[i]) && !NEGATIVES.has(chars[i])){ oIdx=i; break; } }
  // 표기 문자열: 각 글자 뒤에 성분 태그
  const tag={}; if(sIdx>=0)tag[sIdx]='S'; if(vIdx>=0)tag[vIdx]='V'; if(oIdx>=0)tag[oIdx]='O';
  let marked=''; let ci=0;
  for(const ch of clause){
    marked+=ch;
    if(isHan(ch)){ if(tag[ci]) marked+=tag[ci]; ci++; }
  }
  // 생략 주어(E): 주어가 없으면 E 표시(앞에)
  const hasE = sIdx<0;
  if(hasE) marked = 'E'+marked;
  return { marked, s: sIdx>=0?chars[sIdx]:'(E·생략)', v: vIdx>=0?chars[vIdx]:'-', o: oIdx>=0?chars[oIdx]:'-', hasE };
}

// 문장 전체(절 단위로) 성분 표기
function syntaxMarkup(original){
  const clauses = original.split(/[,，]/).map(c=>c.trim()).filter(Boolean);
  const parts = clauses.map(tagClause);
  return {
    marked: parts.map(p=>p.marked).join(' , '),
    clauses: parts,
  };
}

// 사건의미 판정: 술어 동사의 의미로 변화결과/상태/활동 구분
function eventMeaning(predMeaning){
  if(!predMeaning) return '상태';
  if(/(되다|지다|이루다|나다|생기다|변하다|오다|가다|이르다|죽다|살다|망하다|일어나다)/.test(predMeaning)) return '변화결과';
  if(/(있다|없다|같다|아니다|이다|어질다|밝다|높다|크다|많다|드물다|곧다|바르다)/.test(predMeaning)) return '상태';
  return '활동';
}

// 논리관계: 접속사로 절 간 순접/역접 판정
function logicRelation(original){
  if(/而/.test(original)){
    // 而가 대비(부정 포함)면 역접 경향
    if(/不|非|無|莫/.test(original)) return '역접';
    return '순접';
  }
  if(/則/.test(original)) return '조건';
  if(/,|，/.test(original)) return '순접';
  return '-';
}

// 백화(白话) 현대중국어 근사 풀이: 핵심 글자 매핑 기반
const BAIHUA = {
  "學":"学习","習":"温习","時":"经常","說":"高兴","樂":"快乐","知":"了解","仁":"仁德","德":"品德",
  "君子":"君子","小人":"小人","朋":"朋友","友":"朋友","遠":"远","近":"近","來":"来","有":"有","無":"没有",
  "不":"不","必":"一定","孤":"孤单","鄰":"邻居","善":"善良","惡":"恶","過":"过错","改":"改正","學者":"学习的人",
  "父":"父亲","母":"母亲","生":"生养","身":"身体","孝":"孝顺","禮":"礼","信":"诚信","愛":"爱","人":"别人",
};
function toBaihua(original, natural){
  // 1차: 사전 매핑이 가능한 글자를 치환, 나머지는 원문 유지하되 자연어 풀이를 보조로
  // 규칙 근사이므로 한국어 풀이를 중국어 어순 힌트와 함께 제공
  let hint = original;
  for(const [k,v] of Object.entries(BAIHUA)){ hint = hint.split(k).join(v); }
  return hint; // 근사치(참고용)
}

// 퀴즈 2개 자동 생성: ①현대어 풀이 선택 ②핵심 어휘 뜻 맞히기
function quizOf(sent, allNaturals, allMeanings){
  const q = [];
  // Q1: 풀이 선택
  const distract = pickDistinct(allNaturals, sent.natural, 3);
  const opts1 = shuffle([sent.natural, ...distract]);
  q.push({ type:'해석선택', q:`다음 원문의 현대어 풀이로 알맞은 것은? (${sent.original})`,
    options: opts1, answer: opts1.indexOf(sent.natural),
    explain: `출전: ${sent.source}. 바른 풀이는 “${sent.natural}”이다.` });
  // Q2: 어휘 뜻
  const kw = sent.keywords[0];
  if(kw && kw.meaning){
    const dm = pickDistinct(allMeanings, kw.meaning, 3);
    const opts2 = shuffle([kw.meaning, ...dm]);
    q.push({ type:'어휘', q:`‘${kw.word}’(${kw.reading})의 뜻으로 알맞은 것은?`,
      options: opts2, answer: opts2.indexOf(kw.meaning),
      explain: `‘${kw.word}’는 ‘${kw.meaning}’의 뜻이다.` });
  }
  return q;
}
function pickDistinct(pool, exclude, n){
  const cand = pool.filter(x=>x && x!==exclude);
  const out=[]; const used=new Set();
  while(out.length<n && cand.length){
    const i = Math.floor(Math.random()*cand.length);
    const v = cand[i];
    if(!used.has(v)){ used.add(v); out.push(v); }
    if(used.size>=cand.length) break;
  }
  // 부족하면 채움
  while(out.length<n) out.push('(해당 없음)');
  return out;
}
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

// 출전 -> 작가 매핑
const AUTHOR = {
  "사자소학":"전통 학습서","명심보감":"추적(秋適) 엮음","천자문":"주흥사(周興嗣)",
  "논어":"공자와 제자들","맹자":"맹자","노자":"노자(老子)","장자":"장자(莊子)",
  "대학":"증자 계열","중용":"자사(子思)","주역":"미상","순자":"순자(荀子)",
  "채근담":"홍자성(洪自誠)","예기":"미상","효경":"미상","동몽선습":"박세무(朴世茂)",
  "격몽요결":"이이(李珥)","공자가어":"미상","삼국지":"진수(陳壽)","사기":"사마천(司馬遷)",
  "한서":"반고(班固)","후한서":"범엽(范曄)","전국책":"유향(劉向) 엮음","회남자":"유안(劉安)",
  "한유":"한유(韓愈)","주문공":"주희(朱熹)","학림옥로":"나대경(羅大經)","시경":"미상",
  "이백":"이백(李白)","두보":"두보(杜甫)","왕유":"왕유(王維)","맹호연":"맹호연(孟浩然)",
  "왕지환":"왕지환(王之渙)","이신":"이신(李紳)","맹교":"맹교(孟郊)","유종원":"유종원(柳宗元)",
  "민간":"미상","제갈량":"제갈량(諸葛亮)","춘추좌씨전":"좌구명(左丘明)","자치통감":"사마광(司馬光)",
  "북사":"이연수(李延壽)","경덕전등록":"도원(道原)","부현":"부현(傅玄)","공자":"공자(孔子)",
};
const PERIOD = {
  "사자소학":"조선/전통","명심보감":"고려말~조선","천자문":"남북조","논어":"춘추전국","맹자":"춘추전국",
  "노자":"춘추전국","장자":"전국","대학":"춘추전국","중용":"춘추전국","주역":"상고","순자":"전국",
  "채근담":"명","예기":"한","효경":"춘추전국","동몽선습":"조선","격몽요결":"조선","공자가어":"위진",
  "삼국지":"서진","사기":"전한","한서":"후한","후한서":"남조","전국책":"전한","회남자":"전한",
  "한유":"당","주문공":"송","학림옥로":"송","시경":"주","이백":"당","두보":"당","왕유":"당",
  "맹호연":"당","왕지환":"당","이신":"당","맹교":"당","유종원":"당","제갈량":"삼국","춘추좌씨전":"춘추",
  "자치통감":"북송","북사":"당","경덕전등록":"송","부현":"서진","공자":"춘추전국","민간":"전통",
  "출사표":"삼국(촉한)","귀거래사":"동진","애련설":"북송","사설":"당","난정집서":"동진",
  "춘망":"당","정야사":"당","등관작루":"당","춘효":"당","강설":"당","황학루송맹호연":"당",
  "상사":"당","송원이사안서":"당","죽리관":"당","도연명":"동진",
};

// 전문 수록 작품의 정식 제목(작품키 -> 제목)과 작가
const TITLE = {
  "출사표":"출사표(出師表)","귀거래사":"귀거래사(歸去來辭)","애련설":"애련설(愛蓮說)",
  "사설":"사설(師說)","난정집서":"난정집서(蘭亭集序)",
  "춘망":"춘망(春望) — 두보","정야사":"정야사(靜夜思) — 이백","등관작루":"등관작루(登鸛雀樓) — 왕지환",
  "춘효":"춘효(春曉) — 맹호연","강설":"강설(江雪) — 유종원","황학루송맹호연":"황학루송맹호연지광릉 — 이백",
  "상사":"상사(相思) — 왕유","송원이사안서":"송원이사안서(渭城曲) — 왕유","죽리관":"죽리관(竹里館) — 왕유",
};
// 전문 작품 작가 보강
Object.assign(AUTHOR, {
  "출사표":"제갈량(諸葛亮)","귀거래사":"도연명(陶淵明)","애련설":"주돈이(周敦頤)",
  "사설":"한유(韓愈)","난정집서":"왕희지(王羲之)","춘망":"두보(杜甫)","정야사":"이백(李白)",
  "등관작루":"왕지환(王之渙)","춘효":"맹호연(孟浩然)","강설":"유종원(柳宗元)",
  "황학루송맹호연":"이백(李白)","상사":"왕유(王維)","송원이사안서":"왕유(王維)","죽리관":"왕유(王維)",
});

// 파싱: original|natural|source|genre|difficulty|workKey(선택)
const parsed = lines.map(l=>{
  const [original, natural, source, genre, difficulty, workKey] = l.split('|');
  return { original, natural, source, genre, difficulty, workKey: workKey||source };
});
const allNaturals = parsed.map(p=>p.natural);

// 작품(작품키) 단위로 그룹화 — 전문 수록 글은 고유 작품으로 묶임
const groups = {};
parsed.forEach(p=>{ (groups[p.workKey]=groups[p.workKey]||[]).push(p); });

// 전체 어휘 뜻 풀(퀴즈 오답용)
const allMeanings = [...new Set(Object.values(DICT).map(e=>e[1]))];

let sentCounter = 1000;
let workCounter = 100;
const works = [];

for(const [workKey, arr] of Object.entries(groups)){
  workCounter++;
  const source = arr[0].source;   // 실제 출전
  // 작품 난이도 = 최빈값
  const diffCount = {}; arr.forEach(a=>diffCount[a.difficulty]=(diffCount[a.difficulty]||0)+1);
  const difficulty = Object.entries(diffCount).sort((a,b)=>b[1]-a[1])[0][0];
  const genre = arr[0].genre;
  const isFullText = !!TITLE[workKey];  // TITLE에 등록된 전문 수록 작품 여부
  const sentences = arr.map(p=>{
    sentCounter++;
    const chars = [...p.original].filter(isHan);
    const length = chars.length; // 문장 길이(한자 수)
    const keywords = keywordsOf(chars);
    const struct = structureOf(chars);
    const syn = syntaxMarkup(p.original);          // S/V/O/E 성분 표기
    const evt = eventMeaning(meaningOf(struct.predicate)); // 사건의미
    const logic = logicRelation(p.original);       // 논리관계
    const sentObj = {
      id: 'g'+sentCounter,
      original: p.original,
      reading: toReading(p.original),
      length,
      literal_translation: p.natural,           // 큐레이션 풀이를 직역에도 활용
      natural_translation: p.natural,
      baihua: toBaihua(p.original, p.natural),   // 백화(白话) 근사 풀이
      keywords,
      grammar: grammarOf(chars),
      structure: struct,
      // 『공식으로 읽는 논어명구』 분석 틀
      analysis: {
        markup: syn.marked,                      // 예: "中庸S 之 爲V 德O 也"
        event: evt,                              // 변화결과/상태/활동
        logic: logic,                            // 순접/역접/조건
        clauses: syn.clauses.map(c=>({ s:c.s, v:c.v, o:c.o, hasE:c.hasE })),
      },
      background: isFullText ? `${TITLE[workKey]||workKey}의 한 부분이다.` : `${source}에 나오는 문장이다.`,
      exam_point: keywords[0] ? `핵심 어휘 ‘${keywords[0].word}’의 뜻과 문장 구조 파악(${evt})` : '문장 구조 파악',
      source: source,
    };
    return sentObj;
  });
  // 퀴즈는 문장 객체 완성 후 생성(어휘 참조 위해)
  const naturalsForQuiz = sentences.map(s=>s.natural_translation);
  sentences.forEach(s=>{
    s.quiz = quizOf({original:s.original, natural:s.natural_translation, source:source, keywords:s.keywords}, allNaturals, allMeanings);
    delete s.source;
  });

  works.push({
    id: 'gw'+workCounter,
    title: isFullText ? (TITLE[workKey]||workKey) : source,
    author: AUTHOR[source] || AUTHOR[workKey] || '미상',
    source: source,
    period: PERIOD[source] || PERIOD[workKey] || '미상',
    genre,
    difficulty,
    exam_frequency: (['논어','맹자','명심보감','사자소학'].includes(source) || isFullText) ? '상' : '중',
    fullText: isFullText,
    sentences,
  });
}

// 통계
const totalSent = works.reduce((a,w)=>a+w.sentences.length,0);
const lenDist = {};
works.forEach(w=>w.sentences.forEach(s=>{ lenDist[s.length]=(lenDist[s.length]||0)+1; }));
console.error('works:', works.length, 'sentences:', totalSent);
console.error('length distribution:', JSON.stringify(lenDist));

// 출력: GENERATED_WORKS 배열 (JS 리터럴)
const out = 'const GENERATED_WORKS = ' + JSON.stringify(works) + ';';
fs.writeFileSync('/tmp/gen/generated.js', out);
console.error('written generated.js bytes:', out.length);
