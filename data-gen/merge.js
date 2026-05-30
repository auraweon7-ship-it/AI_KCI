// 코퍼스의 대구(2줄)를 완전한 문장 1개로 병합.
// 같은 섹션(# 구분) 안에서 2줄씩 짝지음. 홀수로 남는 줄은 단독 유지.
const fs = require('fs');

function loadSections(file){
  const lines = fs.readFileSync(file,'utf8').split('\n');
  const sections = []; let cur = [];
  for(const raw of lines){
    const l = raw.trim();
    if(l.startsWith('#')){ if(cur.length){ sections.push(cur); cur=[]; } continue; }
    if(!l) continue;
    cur.push(l);
  }
  if(cur.length) sections.push(cur);
  return sections;
}

// 풀이 연결: 앞 구절이 '~고/~며/~면/~나/~니/~요' 등으로 끝나면 그대로, 아니면 자연스럽게 이음
function joinKor(a, b){
  let A = a.trim();
  // 끝의 마침표 제거
  A = A.replace(/[.]$/,'');
  // 연결 어미로 끝나지 않으면 쉼표로 연결
  const connEnd = /(고|며|면|나|니|요|러|아|어|여|게|되|象|,)$/.test(A);
  let sep = connEnd ? ' ' : ', ';
  // 이미 쉼표면 공백
  if(/[,]$/.test(A)) sep=' ';
  return A + sep + b.trim();
}

const out = [];
for(const file of ['/tmp/gen/corpus.txt','/tmp/gen/corpus2.txt','/tmp/gen/corpus_lunyu.txt']){
  const secs = loadSections(file);
  for(const sec of secs){
    // @로 시작하는 줄 = 이미 완성된 문장(병합하지 않고 그대로 사용)
    const ready = sec.filter(l=>l.startsWith('@'));
    const rest  = sec.filter(l=>!l.startsWith('@'));
    ready.forEach(l=>{
      const a=l.slice(1).split('|');   // @ 제거
      out.push(a.concat(a[2]).join('|'));
    });
    for(let i=0;i<rest.length;i+=2){
      const a = rest[i].split('|');
      if(i+1 < rest.length){
        const b = rest[i+1].split('|');
        // 같은 출전이면 병합, 다르면 단독 두 개
        if(a[2]===b[2]){
          const original = a[0] + ', ' + b[0];        // 원문: A, B
          const natural  = joinKor(a[1], b[1]);         // 풀이 연결
          // 갈래/난이도는 더 높은 난이도 채택
          const diffRank = {'초급':1,'중급':2,'고급':3};
          const difficulty = (diffRank[a[4]]>=diffRank[b[4]])?a[4]:b[4];
          out.push([original, natural, a[2], a[3], difficulty, a[2]].join('|'));
        } else {
          out.push(a.concat(a[2]).join('|'));
          out.push(b.concat(b[2]).join('|'));
        }
      } else {
        // 홀수 잔여
        out.push(a.concat(a[2]).join('|'));
      }
    }
  }
}

fs.writeFileSync('/tmp/gen/merged_couplets.txt', out.join('\n')+'\n');
console.error('merged couplet sentences:', out.length);
