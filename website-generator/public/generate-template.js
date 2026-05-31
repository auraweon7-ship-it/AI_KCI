function generateInfoCards(topic, siteType) {
  const cards = {
    landing: [
      { icon: '&#9670;', title: '비전', desc: topic + '의 혁신적인 비전과 미래 지향적 목표를 소개합니다' },
      { icon: '&#9733;', title: '핵심 가치', desc: '고객 중심의 사고와 지속 가능한 성장을 추구합니다' },
      { icon: '&#9879;', title: '기술력', desc: '최첨단 기술과 노하우를 바탕으로 업계를 선도합니다' },
      { icon: '&#10003;', title: '신뢰', desc: '투명한 운영과 검증된 실적으로 파트너의 신뢰를 얻고 있습니다' },
    ],
    portfolio: [
      { icon: '&#9998;', title: '크리에이티브', desc: '독창적인 시각으로 차별화된 결과물을 만들어냅니다' },
      { icon: '&#9881;', title: '프로세스', desc: '체계적인 워크플로우로 효율적인 프로젝트 진행' },
      { icon: '&#9889;', title: '경험', desc: '다양한 분야에서 축적된 전문 경험과 포트폴리오' },
      { icon: '&#10084;', title: '열정', desc: '매 프로젝트에 진심을 담아 최고의 품질을 추구합니다' },
    ],
    saas: [
      { icon: '&#9889;', title: '빠른 속도', desc: '밀리초 단위 응답 속도로 끊김 없는 서비스 제공' },
      { icon: '&#9875;', title: '보안', desc: 'SOC 2 인증 기반 엔터프라이즈급 보안 아키텍처' },
      { icon: '&#9881;', title: 'API 연동', desc: 'RESTful API로 기존 시스템과 원활하게 통합' },
      { icon: '&#9729;', title: '확장성', desc: '트래픽 증가에 자동 대응하는 클라우드 네이티브 인프라' },
    ],
    brand: [
      { icon: '&#9670;', title: '브랜드 철학', desc: topic + '만의 고유한 가치관과 브랜드 스토리' },
      { icon: '&#9733;', title: '프리미엄', desc: '타협 없는 품질과 세심한 디테일에 대한 집착' },
      { icon: '&#10084;', title: '고객 경험', desc: '모든 접점에서 일관된 프리미엄 경험을 설계합니다' },
      { icon: '&#9998;', title: '장인 정신', desc: '시간이 지나도 변하지 않는 클래식한 가치를 추구' },
    ],
    event: [
      { icon: '&#9733;', title: '프로그램', desc: '영감을 주는 세션과 네트워킹 기회를 제공합니다' },
      { icon: '&#9998;', title: '스피커', desc: '업계 최고의 전문가들이 인사이트를 공유합니다' },
      { icon: '&#9889;', title: '라이브', desc: '온/오프라인 동시 참여가 가능한 하이브리드 구성' },
      { icon: '&#10003;', title: '참가 혜택', desc: '독점 자료와 커뮤니티 접근 권한을 제공합니다' },
    ],
    restaurant: [
      { icon: '&#9733;', title: '셰프 소개', desc: '최고의 식재료와 정성으로 요리를 완성합니다' },
      { icon: '&#10084;', title: '분위기', desc: '특별한 순간을 위한 세심하게 설계된 공간' },
      { icon: '&#9998;', title: '메뉴 철학', desc: '제철 식재료 기반의 계절 메뉴를 선보입니다' },
      { icon: '&#9879;', title: '예약', desc: '편리한 온라인 예약과 프라이빗 다이닝 운영' },
    ],
    studio: [
      { icon: '&#9998;', title: '디자인', desc: '기능과 미학의 완벽한 균형을 추구하는 디자인 철학' },
      { icon: '&#9881;', title: '프로덕션', desc: '기획부터 제작까지 원스톱 프로덕션 시스템' },
      { icon: '&#9889;', title: '혁신', desc: '새로운 기술과 매체를 활용한 실험적 작업' },
      { icon: '&#9733;', title: '수상 경력', desc: '국내외 디자인 어워드 다수 수상' },
    ],
  };
  return cards[siteType] || cards.landing;
}

function generateWebsite(topic, siteType, features, colorTheme, imgUrl, vidUrl, menuItems) {
  menuItems = menuItems || [];
  const palettes = {
    dark: {
      bg:'#0c0b09', bgInverse:'#f5f3f0', surface:'#151412', card:'rgba(18,16,14,0.82)',
      cardBorder:'rgba(255,248,241,0.06)', text:'#ede8e0', textSec:'#8a8279',
      accent:'#e8572a', accentGlow:'rgba(232,87,42,0.25)', muted:'rgba(237,232,224,0.4)',
      gradStart:'#0c0b09', gradEnd:'#1a1815'
    },
    light: {
      bg:'#f5f3f0', bgInverse:'#1a1816', surface:'#eae6e0', card:'rgba(255,255,255,0.82)',
      cardBorder:'rgba(0,0,0,0.06)', text:'#1a1816', textSec:'#6b6560',
      accent:'#2563eb', accentGlow:'rgba(37,99,235,0.25)', muted:'rgba(26,24,22,0.4)',
      gradStart:'#f5f3f0', gradEnd:'#eae6e0'
    },
    warm: {
      bg:'#1a1410', bgInverse:'#f5efe6', surface:'#231d17', card:'rgba(26,20,16,0.82)',
      cardBorder:'rgba(245,239,230,0.06)', text:'#f5efe6', textSec:'#a0917e',
      accent:'#d4a574', accentGlow:'rgba(212,165,116,0.25)', muted:'rgba(245,239,230,0.4)',
      gradStart:'#1a1410', gradEnd:'#2a2318'
    },
    cool: {
      bg:'#0a0e14', bgInverse:'#e8edf5', surface:'#0f1520', card:'rgba(10,14,20,0.82)',
      cardBorder:'rgba(232,237,245,0.06)', text:'#e8edf5', textSec:'#7a8494',
      accent:'#60a5fa', accentGlow:'rgba(96,165,250,0.25)', muted:'rgba(232,237,245,0.4)',
      gradStart:'#0a0e14', gradEnd:'#141c28'
    },
    mono: {
      bg:'#0c0c0c', bgInverse:'#f0f0f0', surface:'#161616', card:'rgba(12,12,12,0.82)',
      cardBorder:'rgba(229,229,229,0.06)', text:'#e5e5e5', textSec:'#777',
      accent:'#a3a3a3', accentGlow:'rgba(163,163,163,0.2)', muted:'rgba(229,229,229,0.35)',
      gradStart:'#0c0c0c', gradEnd:'#1a1a1a'
    }
  };
  const c = palettes[colorTheme] || palettes.dark;
  const heroImg = imgUrl || 'https://picsum.photos/seed/' + encodeURIComponent(topic) + '/1920/1080';
  const heroVid = vidUrl || '';
  const hasGallery = features.includes('gallery');
  const hasContact = features.includes('contact');
  const hasPricing = features.includes('pricing');
  const hasTestimonial = features.includes('testimonial');
  const hasTeam = features.includes('team');
  const hasFaq = features.includes('faq');
  const hasTimeline = features.includes('timeline');
  const hasPartners = features.includes('partners');
  const hasBlog = features.includes('blog');
  const hasMap = features.includes('map');
  const infoCards = generateInfoCards(topic, siteType);

  const typeLabels = {
    landing:'Explore', portfolio:'Portfolio', saas:'Product', brand:'Brand',
    event:'Event', restaurant:'Dining', studio:'Studio'
  };
  const heroLabel = typeLabels[siteType] || 'Explore';

  const topicWords = topic.split(/\s+/).map(w =>
    '<span class="word">' + w + '</span>'
  ).join('\n          ');

  const navLinks = menuItems.length > 0
    ? menuItems.map(m => `<a href="${m.link}" class="nav-link">${m.name}</a>`).join('\n        ')
    : `<a href="#about" class="nav-link">소개</a>
        <a href="#features" class="nav-link">역량</a>
        <a href="#stats" class="nav-link">성과</a>
        <a href="#contact" class="nav-link">문의</a>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${topic}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Noto+Sans+KR:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{
  --bg:${c.bg};--bg-inverse:${c.bgInverse};--surface:${c.surface};
  --card:${c.card};--card-border:${c.cardBorder};
  --text:${c.text};--text-sec:${c.textSec};--accent:${c.accent};
  --accent-glow:${c.accentGlow};--muted:${c.muted};
  --font-display:'Outfit',sans-serif;
  --font-body:'Noto Sans KR','Outfit',sans-serif;
  --ease:cubic-bezier(.22,1,.36,1);
  --scroll-height:900vh;
}
[data-active-theme="dark"]{--bg:${c.bg};--text:${c.text};--text-sec:${c.textSec}}
[data-active-theme="light"]{--bg:${c.bgInverse};--text:${c.bg};--text-sec:${c.textSec}}

*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html.lenis,html.lenis body{height:auto}
.lenis.lenis-smooth{scroll-behavior:auto}
body{font-family:var(--font-body);background:var(--bg);color:var(--text);
  overflow-x:hidden;-webkit-font-smoothing:antialiased;
  word-break:keep-all;overflow-wrap:break-word;
  transition:background .8s var(--ease),color .8s var(--ease)}

/* Nav */
.site-nav{position:fixed;top:0;left:0;right:0;z-index:50;padding:1.25rem 0;
  transition:background .5s var(--ease),backdrop-filter .5s var(--ease)}
.site-nav.scrolled{background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(20px) saturate(1.4)}
.site-nav nav{display:flex;align-items:center;justify-content:space-between;
  max-width:1200px;margin:0 auto;padding:0 clamp(1rem,4vw,3rem)}
.nav-logo{font-family:var(--font-display);font-weight:700;font-size:1rem;letter-spacing:-.02em;
  color:var(--text);text-decoration:none}
.nav-links{display:flex;align-items:center;gap:clamp(1rem,2.5vw,2.5rem)}
.nav-link{font-size:.78rem;font-weight:500;letter-spacing:.04em;text-transform:uppercase;
  color:var(--text-sec);text-decoration:none;transition:color .3s var(--ease);position:relative}
.nav-link:hover{color:var(--text)}
.nav-link::after{content:'';position:absolute;bottom:-4px;left:0;width:0;height:1px;
  background:var(--accent);transition:width .3s var(--ease)}
.nav-link:hover::after{width:100%}
.nav-toggle{display:none;flex-direction:column;gap:5px;padding:4px;background:none;border:none;cursor:pointer}
.nav-toggle span{display:block;width:20px;height:1.5px;background:var(--text);transition:all .3s var(--ease)}
.nav-toggle.active span:first-child{transform:rotate(45deg) translate(2.3px,2.3px)}
.nav-toggle.active span:last-child{transform:rotate(-45deg) translate(2.3px,-2.3px)}
@media(max-width:768px){
  .nav-toggle{display:flex}
  .nav-links{position:fixed;top:0;left:0;right:0;bottom:0;flex-direction:column;justify-content:center;gap:2rem;
    background:color-mix(in srgb,var(--bg) 95%,transparent);backdrop-filter:blur(24px);
    opacity:0;pointer-events:none;transition:opacity .4s var(--ease)}
  .nav-links.open{opacity:1;pointer-events:auto}
  .nav-link{font-size:1.2rem}
}

.skip-link{position:fixed;top:-100%;left:50%;transform:translateX(-50%);
  background:var(--accent);color:#fff;padding:.8rem 1.6rem;border-radius:0 0 8px 8px;
  z-index:10000;font-weight:600;transition:top .2s}
.skip-link:focus{top:0}

/* Loader */
#loader{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;
  align-items:center;justify-content:center;background:var(--bg);color:var(--text)}
.loader-brand{font-family:var(--font-display);font-size:1.2rem;letter-spacing:.15em;
  text-transform:uppercase;margin-bottom:2rem;font-weight:300}
.loader-track{width:min(240px,60vw);height:1px;background:var(--muted);overflow:hidden}
#loader-bar{height:100%;width:0;background:var(--accent);transition:width .15s linear}
#loader-percent{margin-top:1rem;font-size:.8rem;font-variant-numeric:tabular-nums;opacity:.5}

/* Progress */
.progress-track{position:fixed;right:1.5rem;top:50%;transform:translateY(-50%);
  width:2px;height:30vh;background:var(--muted);z-index:100;border-radius:1px}
.progress-fill{width:100%;height:0;background:var(--accent);border-radius:1px;transition:height .1s linear}
.progress-label{position:absolute;right:12px;top:0;font-size:.6rem;letter-spacing:.08em;
  text-transform:uppercase;white-space:nowrap;opacity:.5;transform:translateY(-50%)}

/* Hero */
.hero-standalone{position:relative;z-index:5;min-height:100vh;min-height:100dvh;width:100%;
  display:flex;flex-direction:column;justify-content:flex-end;padding:0 8vw 6vh;overflow:hidden}
.hero-bg{position:absolute;inset:0;z-index:0}
.hero-bg img,.hero-bg video{width:100%;height:100%;object-fit:cover}
.hero-overlay-grad{position:absolute;inset:0;z-index:1;
  background:linear-gradient(180deg,${c.bg}99 0%,transparent 30%,${c.bg}cc 70%,${c.bg} 100%)}
.hero-content{position:relative;z-index:2}
.hero-badge{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .85rem;border-radius:9999px;
  font-size:.65rem;font-weight:500;text-transform:uppercase;letter-spacing:.14em;
  background:${c.accentGlow};color:var(--accent);border:1px solid ${c.accentGlow};margin-bottom:1.5rem}
.hero-heading{font-family:var(--font-display);font-size:clamp(3rem,10vw,8rem);font-weight:800;
  line-height:.95;letter-spacing:-.04em}
.hero-heading .word{display:inline-block;opacity:0;transform:translateY(40px)}
.hero-tagline{margin-top:1.5rem;font-size:clamp(1rem,1.6vw,1.25rem);color:var(--text-sec);max-width:36ch;line-height:1.7}
.scroll-cue{position:absolute;bottom:3rem;left:8vw;font-size:.7rem;letter-spacing:.12em;
  text-transform:uppercase;opacity:.35;display:flex;flex-direction:column;align-items:center;gap:.5rem}
.scroll-cue span:last-child{width:1px;height:2.5rem;
  background:linear-gradient(to bottom,var(--text),transparent);animation:cue-pulse 2s infinite}
@keyframes cue-pulse{0%,100%{opacity:.3}50%{opacity:1}}

/* Canvas */
.canvas-wrap{position:fixed;inset:0;z-index:1;clip-path:circle(0% at 50% 50%)}
.canvas-wrap canvas{width:100%;height:100%;display:block}

/* Scene Overlay (video 2 area) */
#dark-overlay{position:fixed;inset:0;z-index:3;background:var(--bg);opacity:0;
  pointer-events:none;transition:background .8s var(--ease)}

/* Marquee */
.marquee-wrap{position:fixed;top:50%;left:0;width:100%;z-index:4;
  transform:translateY(-50%);overflow:visible;pointer-events:none;opacity:0}
.marquee-text{font-family:var(--font-display);font-size:clamp(6rem,14vw,14vw);
  font-weight:900;white-space:nowrap;color:var(--text);opacity:.06;will-change:transform}

/* Scroll sections */
#scroll-container{position:relative;height:var(--scroll-height);z-index:4}
.scroll-section{position:absolute;width:100%;display:flex;align-items:center;
  pointer-events:none;opacity:0}
.scroll-section.is-visible{pointer-events:auto}
.scroll-section .section-label,.scroll-section .section-heading,
.scroll-section .section-body,.scroll-section .stat,
.scroll-section .cta-button,.scroll-section .info-card-inner{
  will-change:transform,opacity;backface-visibility:hidden;transform:translateZ(0)}
.section-inner{max-width:42vw}
.align-left{padding:0 50vw 0 6vw;justify-content:flex-start}
.align-right{padding:0 6vw 0 50vw;justify-content:flex-end}
.align-center{justify-content:center;text-align:center;padding:0 6vw}
.align-center .section-inner{max-width:700px;margin:0 auto}

.section-label{display:block;font-size:.65rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--text-sec);margin-bottom:1rem;font-weight:500}
.section-heading{font-family:var(--font-display);font-size:clamp(2rem,4.5vw,4.5rem);
  font-weight:700;line-height:1.05;letter-spacing:-.03em;margin-bottom:1rem;text-wrap:balance}
.section-body{font-size:clamp(.9rem,1.1vw,1.1rem);line-height:1.7;color:var(--text-sec)}

/* Info cards in scroll sections */
.info-grid-scroll{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem;margin-top:1.5rem}
.info-card-outer{background:${c.cardBorder};border:1px solid ${c.cardBorder};border-radius:1.25rem;padding:4px}
.info-card-inner{background:var(--surface);border-radius:calc(1.25rem - 4px);padding:1.5rem;
  box-shadow:inset 0 1px 1px ${c.cardBorder};position:relative;overflow:hidden}
.info-card-inner::before{content:'';position:absolute;top:0;right:0;width:80px;height:80px;
  border-radius:50%;background:${c.accentGlow};filter:blur(30px);pointer-events:none}
.info-icon{font-size:1.2rem;margin-bottom:.75rem;display:flex;align-items:center;justify-content:center;
  width:2.5rem;height:2.5rem;border-radius:.75rem;background:${c.accentGlow};border:1px solid ${c.accentGlow}}
.info-card-inner h3{font-size:1rem;font-weight:700;letter-spacing:-.01em;margin-bottom:.35rem}
.info-card-inner p{font-size:.8rem;color:var(--text-sec);line-height:1.6}

/* Stats */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:2rem;text-align:center}
.stat-number{font-family:var(--font-display);font-size:clamp(2.5rem,5vw,4.5rem);font-weight:800;
  font-variant-numeric:tabular-nums;display:block;color:var(--accent)}
.stat-suffix{font-size:1.2rem;opacity:.7}
.stat-label{display:block;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;margin-top:.4rem;opacity:.5}

/* CTA */
.cta-button{display:inline-block;margin-top:1.5rem;padding:1rem 2.4rem;
  background:var(--accent);color:#fff;font-family:var(--font-display);
  font-size:.85rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  text-decoration:none;border-radius:2px;transition:transform .2s,box-shadow .2s}
.cta-button:hover{transform:translateY(-2px);box-shadow:0 6px 20px ${c.accentGlow}}

/* Footer inside scroll */
.footer-section{padding:3rem 6vw;text-align:center;font-size:.75rem;color:var(--text-sec);opacity:.5}

/* Grain overlay */
.grain::after{content:'';position:fixed;inset:0;z-index:9998;pointer-events:none;opacity:.025;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}

@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}
  .marquee-wrap{display:none!important}
  .scroll-section{opacity:1!important;transform:none!important}
}
@media(max-width:768px){
  :root{--scroll-height:600vh}
  .hero-heading{font-size:2.8rem}
  .align-left,.align-right{padding:0 6vw;justify-content:center}
  .section-inner{max-width:100%;background:${c.card};padding:1.5rem;border-radius:8px;backdrop-filter:blur(8px)}
  .info-grid-scroll{grid-template-columns:1fr}
  .progress-track{display:none}
}
</style>
</head>
<body class="grain">

<a href="#main-content" class="skip-link">Skip to content</a>

<div id="loader" role="status" aria-label="Loading">
  <div class="loader-brand">${topic}</div>
  <div class="loader-track"><div id="loader-bar"></div></div>
  <div id="loader-percent">0%</div>
</div>

<header class="site-nav" id="site-nav">
  <nav>
    <a href="#" class="nav-logo">${topic}</a>
    <button class="nav-toggle" id="nav-toggle" aria-label="메뉴 열기">
      <span></span><span></span>
    </button>
    <div class="nav-links" id="nav-links">
      ${navLinks}
    </div>
  </nav>
</header>

<div class="progress-track" aria-hidden="true">
  <div class="progress-fill" id="progress-fill"></div>
  <div class="progress-label" id="progress-label"></div>
</div>

<section class="hero-standalone" id="hero" aria-label="Hero">
  <div class="hero-bg">
    ${heroVid
      ? '<video src="' + heroVid + '" autoplay muted loop playsinline></video>'
      : '<img src="' + heroImg + '" alt="">'}
  </div>
  <div class="hero-overlay-grad"></div>
  <div class="hero-content">
    <div class="hero-badge">&#9670; ${heroLabel}</div>
    <h1 class="hero-heading">
      ${topicWords}
    </h1>
    <p class="hero-tagline">AI가 생성한 비주얼과 스크롤 연동 시네마틱 인터랙션이 적용된 프리미엄 웹 경험</p>
  </div>
  <div class="scroll-cue" aria-hidden="true">
    <span>Scroll</span>
    <span></span>
  </div>
</section>

<div class="canvas-wrap" id="canvas-wrap">
  <canvas id="canvas"></canvas>
</div>

<div id="dark-overlay" aria-hidden="true"></div>

<div class="marquee-wrap" data-scroll-speed="-25" data-enter="20" data-leave="80" aria-hidden="true">
  <div class="marquee-text">${topic} &mdash; ${topic} &mdash; ${topic} &mdash;</div>
</div>

<main id="scroll-container" id="main-content">

  <!-- About section -->
  <section class="scroll-section align-left"
    data-enter="14" data-leave="30"
    data-animation="slide-left" data-exit="fade-out" data-theme="dark">
    <div class="section-inner">
      <span class="section-label">001 / About</span>
      <h2 class="section-heading">${topic} 소개</h2>
      <p class="section-body">${topic}의 핵심 가치와 차별화된 역량을 소개합니다</p>
      <div class="info-grid-scroll" style="margin-top:1.5rem">
        ${infoCards.slice(0,2).map((card,i) => `
        <div class="info-card-outer">
          <div class="info-card-inner">
            <div class="info-icon">${card.icon}</div>
            <h3>${card.title}</h3>
            <p>${card.desc}</p>
          </div>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <!-- Features section -->
  <section class="scroll-section align-right"
    data-enter="30" data-leave="46"
    data-animation="slide-right" data-exit="blur-out" data-theme="dark">
    <div class="section-inner">
      <span class="section-label">002 / Features</span>
      <h2 class="section-heading">주요 역량</h2>
      <p class="section-body">차별화된 기술력과 전문성으로 최고의 결과를 만듭니다</p>
      <div class="info-grid-scroll" style="margin-top:1.5rem">
        ${infoCards.slice(2,4).map((card,i) => `
        <div class="info-card-outer">
          <div class="info-card-inner">
            <div class="info-icon">${card.icon}</div>
            <h3>${card.title}</h3>
            <p>${card.desc}</p>
          </div>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <!-- Stats section -->
  <section class="scroll-section align-center section-stats"
    data-enter="48" data-leave="62"
    data-animation="stagger-up" data-exit="fade-out" data-theme="dark">
    <div class="section-inner" style="max-width:800px">
      <span class="section-label">003 / Numbers</span>
      <h2 class="section-heading" style="text-align:center">성과</h2>
      <div class="stats-grid" style="margin-top:2rem">
        <div class="stat">
          <span class="stat-number" data-value="150" data-decimals="0">0</span>
          <span class="stat-suffix">+</span>
          <span class="stat-label">프로젝트</span>
        </div>
        <div class="stat">
          <span class="stat-number" data-value="98" data-decimals="0">0</span>
          <span class="stat-suffix">%</span>
          <span class="stat-label">만족도</span>
        </div>
        <div class="stat">
          <span class="stat-number" data-value="50" data-decimals="0">0</span>
          <span class="stat-suffix">+</span>
          <span class="stat-label">파트너</span>
        </div>
      </div>
    </div>
  </section>

  ${hasGallery ? `
  <section class="scroll-section align-left"
    data-enter="62" data-leave="74"
    data-animation="scale-up" data-exit="slide-away" data-theme="dark">
    <div class="section-inner" style="max-width:50vw">
      <span class="section-label">004 / Gallery</span>
      <h2 class="section-heading">갤러리</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:1rem">
        ${[1,2,3,4,5,6].map(i => '<img src="https://picsum.photos/seed/' + encodeURIComponent(topic) + i + '/300/300" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:.5rem">').join('\n        ')}
      </div>
    </div>
  </section>` : ''}

  ${hasPricing ? `
  <section class="scroll-section align-center"
    data-enter="${hasGallery ? '74' : '64'}" data-leave="${hasGallery ? '86' : '78'}"
    data-animation="fade-up" data-exit="scale-down" data-theme="dark">
    <div class="section-inner" style="max-width:800px">
      <span class="section-label">${hasGallery ? '005' : '004'} / Pricing</span>
      <h2 class="section-heading">요금제</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-top:1.5rem">
        <div style="background:var(--surface);border:1px solid ${c.cardBorder};border-radius:1rem;padding:1.5rem;text-align:center">
          <h3 style="font-size:1rem;font-weight:700">Basic</h3>
          <div style="font-family:var(--font-display);font-size:2rem;font-weight:800;margin:.5rem 0">Free</div>
          <p style="font-size:.8rem;color:var(--text-sec);line-height:1.6">기본 기능 포함</p>
        </div>
        <div style="background:var(--surface);border:1px solid var(--accent);border-radius:1rem;padding:1.5rem;text-align:center;box-shadow:0 0 24px ${c.accentGlow}">
          <h3 style="font-size:1rem;font-weight:700;color:var(--accent)">Pro</h3>
          <div style="font-family:var(--font-display);font-size:2rem;font-weight:800;margin:.5rem 0">$29</div>
          <p style="font-size:.8rem;color:var(--text-sec);line-height:1.6">전체 기능 + API</p>
        </div>
        <div style="background:var(--surface);border:1px solid ${c.cardBorder};border-radius:1rem;padding:1.5rem;text-align:center">
          <h3 style="font-size:1rem;font-weight:700">Enterprise</h3>
          <div style="font-family:var(--font-display);font-size:2rem;font-weight:800;margin:.5rem 0">Custom</div>
          <p style="font-size:.8rem;color:var(--text-sec);line-height:1.6">맞춤형 솔루션</p>
        </div>
      </div>
    </div>
  </section>` : ''}

  ${hasContact ? `
  <section class="scroll-section align-left"
    data-enter="${hasPricing ? (hasGallery ? '86' : '78') : (hasGallery ? '74' : '64')}"
    data-leave="${hasPricing ? (hasGallery ? '94' : '88') : (hasGallery ? '84' : '78')}"
    data-animation="clip-reveal" data-exit="blur-out" data-theme="dark">
    <div class="section-inner">
      <span class="section-label">Contact</span>
      <h2 class="section-heading">문의하기</h2>
      <form onsubmit="event.preventDefault()" style="margin-top:1rem">
        <input type="text" placeholder="이름" style="width:100%;padding:.75rem 1rem;background:var(--surface);border:1px solid ${c.cardBorder};border-radius:.5rem;color:var(--text);font-family:inherit;font-size:.9rem;margin-bottom:.5rem;outline:none">
        <input type="email" placeholder="이메일" style="width:100%;padding:.75rem 1rem;background:var(--surface);border:1px solid ${c.cardBorder};border-radius:.5rem;color:var(--text);font-family:inherit;font-size:.9rem;margin-bottom:.5rem;outline:none">
        <textarea placeholder="메시지" style="width:100%;padding:.75rem 1rem;background:var(--surface);border:1px solid ${c.cardBorder};border-radius:.5rem;color:var(--text);font-family:inherit;font-size:.9rem;min-height:80px;resize:vertical;outline:none"></textarea>
        <button type="submit" class="cta-button" style="margin-top:.75rem">보내기</button>
      </form>
    </div>
  </section>` : ''}

  <!-- CTA final section -->
  <section class="scroll-section align-center section-cta"
    data-enter="88" data-leave="100"
    data-animation="elastic-scale" data-persist="true" data-theme="dark">
    <div class="section-inner" style="text-align:center">
      <span class="section-label">FINAL</span>
      <h2 class="section-heading">${topic}</h2>
      <p class="section-body" style="margin:0 auto">함께 새로운 가능성을 만들어갑니다</p>
      <a href="#" class="cta-button">시작하기</a>
      <div class="footer-section" style="margin-top:4rem">Built with SiteForge &mdash; Powered by Higgsfield AI</div>
    </div>
  </section>

</main>

${'<'}script src="https://cdn.jsdelivr.net/npm/lenis@1/dist/lenis.min.js">${'<'}/script>
${'<'}script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js">${'<'}/script>
${'<'}script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js">${'<'}/script>
${'<'}script>
(function(){
  "use strict";

  const CONFIG = {
    heroImg: '${heroImg}',
    heroVid: '${heroVid}',
    imageScale: 0.88,
    frameSpeed: 2.0,
    bgSampleInterval: 30
  };

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const canvas = $("#canvas");
  const ctx = canvas.getContext("2d");
  const canvasWrap = $("#canvas-wrap");
  const heroSection = $("#hero");
  const scrollContainer = $("#scroll-container");
  const loader = $("#loader");
  const loaderBar = $("#loader-bar");
  const loaderPct = $("#loader-percent");
  const progressFill = $("#progress-fill");
  const progressLabel = $("#progress-label");

  let bgColor = "${c.bg}";
  let heroImage = null;

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
  }

  function drawImage(img, progress) {
    if (!img) return;
    const cw = window.innerWidth, ch = window.innerHeight;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(cw/iw, ch/ih) * (CONFIG.imageScale + progress * 0.12);
    const dw = iw*scale, dh = ih*scale;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.globalAlpha = 0.3 + progress * 0.7;
    ctx.drawImage(img, (cw-dw)/2, (ch-dh)/2, dw, dh);
    ctx.restore();
  }

  function preload() {
    loaderBar.style.width = "30%";
    loaderPct.textContent = "30%";
    function tryLoad(useCORS) {
      const img = new Image();
      if (useCORS) img.crossOrigin = "anonymous";
      img.onload = () => {
        heroImage = img;
        loaderBar.style.width = "100%";
        loaderPct.textContent = "100%";
        resizeCanvas();
        drawImage(img, 0);
        setTimeout(() => {
          loader.style.opacity = "0";
          setTimeout(() => loader.style.display = "none", 500);
          initEngine();
        }, 400);
      };
      img.onerror = () => {
        if (useCORS) { tryLoad(false); return; }
        loader.style.opacity = "0";
        setTimeout(() => loader.style.display = "none", 300);
        initEngine();
      };
      img.src = CONFIG.heroImg;
    }
    tryLoad(true);
  }

  // Lenis
  let lenis;
  function initLenis() {
    lenis = new Lenis({ duration: 1.2, easing: t => Math.min(1, 1.001 - Math.pow(2, -10*t)), smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  // Hero entrance
  function initHero() {
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
      $$(".hero-heading .word").forEach(w => { w.style.opacity=1; w.style.transform="none"; });
      return;
    }
    gsap.to(".hero-heading .word", { opacity:1, y:0, stagger:.08, duration:.9, ease:"power3.out", delay:.3 });
    gsap.from(".hero-tagline", { opacity:0, y:20, duration:.8, delay:.8 });
    gsap.from(".scroll-cue", { opacity:0, y:10, duration:.6, delay:1.2 });
  }

  // Hero wipe + canvas
  function initHeroTransition() {
    ScrollTrigger.create({
      trigger: scrollContainer, start:"top top", end:"bottom bottom", scrub:.5,
      onUpdate: self => {
        const p = self.progress;
        heroSection.style.opacity = Math.max(0, 1 - p*15);
        const wipe = Math.min(1, Math.max(0, (p-.01)/.06));
        canvasWrap.style.clipPath = "circle(" + (wipe*80) + "% at 50% 50%)";
        if (heroImage) {
          const acc = Math.min(p * CONFIG.frameSpeed, 1);
          drawImage(heroImage, acc);
        }
      }
    });
  }

  // Animation system
  const ENTER_PHASE = 0.30;
  const EXIT_PHASE = 0.20;

  const ENTER_ANIMATIONS = {
    "fade-up":       () => ({y:40, opacity:0, stagger:.06, duration:.7, ease:"power3.out"}),
    "slide-left":    () => ({x:-50, opacity:0, stagger:.07, duration:.7, ease:"power3.out"}),
    "slide-right":   () => ({x:50, opacity:0, stagger:.07, duration:.7, ease:"power3.out"}),
    "scale-up":      () => ({scale:.88, opacity:0, stagger:.06, duration:.8, ease:"power2.out"}),
    "stagger-up":    () => ({y:50, opacity:0, stagger:.08, duration:.7, ease:"power3.out"}),
    "clip-reveal":   () => ({clipPath:"inset(100% 0 0 0)", opacity:0, stagger:.07, duration:.85, ease:"power3.out"}),
    "blur-in":       () => ({filter:"blur(10px)", opacity:0, stagger:.06, duration:.8, ease:"power2.out"}),
    "elastic-scale": () => ({scale:.6, opacity:0, stagger:.08, duration:1, ease:"back.out(1.4)"}),
  };
  const EXIT_ANIMATIONS = {
    "fade-out":   () => ({opacity:0, duration:.5, ease:"power2.in"}),
    "slide-away": () => ({x:-100, opacity:0, duration:.6, ease:"power3.in"}),
    "scale-down": () => ({scale:.9, opacity:0, duration:.5, ease:"power2.in"}),
    "blur-out":   () => ({filter:"blur(10px)", opacity:0, duration:.6, ease:"power2.in"}),
  };

  function setupSection(section) {
    const type = section.dataset.animation;
    const exitType = section.dataset.exit;
    const persist = section.dataset.persist === "true";
    const enter = parseFloat(section.dataset.enter)/100;
    const leave = parseFloat(section.dataset.leave)/100;
    const mid = ((enter+leave)/2)*100;
    section.style.top = mid+"%";
    section.style.transform = "translateY(-50%)";

    const children = section.querySelectorAll(".section-label,.section-heading,.section-body,.cta-button,.stat,.info-card-outer");

    const enterTl = gsap.timeline({paused:true});
    if (ENTER_ANIMATIONS[type]) enterTl.from(children, {...ENTER_ANIMATIONS[type](), lazy:false});
    enterTl.progress(0).pause();

    let exitTl = null;
    if (exitType && EXIT_ANIMATIONS[exitType]) {
      exitTl = gsap.timeline({paused:true});
      exitTl.to(children, {...EXIT_ANIMATIONS[exitType](), lazy:false});
    }

    ScrollTrigger.create({
      trigger:scrollContainer, start:"top top", end:"bottom bottom", scrub:.5,
      onUpdate: self => {
        const p = self.progress;
        if (p < enter) {
          section.style.opacity = 0;
          section.classList.remove("is-visible");
          enterTl.progress(0);
          if (exitTl) exitTl.progress(0);
          return;
        }
        if (p <= leave) {
          const lp = (p - enter)/(leave - enter);
          section.style.opacity = 1;
          section.classList.add("is-visible");
          enterTl.progress(Math.min(1, lp/ENTER_PHASE));
          if (exitTl) {
            const es = 1 - EXIT_PHASE;
            exitTl.progress(lp > es ? (lp-es)/EXIT_PHASE : 0);
          }
          return;
        }
        if (persist) {
          section.style.opacity = 1; section.classList.add("is-visible");
          enterTl.progress(1); if(exitTl) exitTl.progress(0);
        } else {
          if(exitTl) exitTl.progress(1);
          const xp = Math.min(1,(p-leave)/.05);
          section.style.opacity = 1 - xp;
          if(xp>=1) section.classList.remove("is-visible");
        }
      }
    });
  }

  // Counters
  function initCounters() {
    const ease = t => 1 - Math.pow(1-t, 3);
    $$(".stat-number").forEach(el => {
      const target = parseFloat(el.dataset.value);
      const dec = parseInt(el.dataset.decimals||"0");
      const sec = el.closest(".scroll-section");
      const enter = parseFloat(sec.dataset.enter)/100;
      const leave = parseFloat(sec.dataset.leave)/100;
      const fmt = v => dec > 0 ? v.toFixed(dec) : String(Math.round(v));
      ScrollTrigger.create({
        trigger:scrollContainer, start:"top top", end:"bottom bottom", scrub:.5,
        onUpdate: self => {
          const p = self.progress;
          if(p<enter){el.textContent="0";return}
          if(p>leave){el.textContent=fmt(target);return}
          const lp=(p-enter)/(leave-enter);
          if(lp<.4) el.textContent="0";
          else if(lp>=.8) el.textContent=fmt(target);
          else el.textContent=fmt(target*ease((lp-.4)/.4));
        }
      });
    });
  }

  // Marquee
  function initMarquee() {
    $$(".marquee-wrap").forEach(wrap => {
      const speed = parseFloat(wrap.dataset.scrollSpeed)||-25;
      const text = wrap.querySelector(".marquee-text");
      const eAt = parseFloat(wrap.dataset.enter||"20")/100;
      const lAt = parseFloat(wrap.dataset.leave||"80")/100;
      gsap.to(text, {xPercent:speed, ease:"none",
        scrollTrigger:{trigger:scrollContainer, start:"top top", end:"bottom bottom", scrub:.5}});
      ScrollTrigger.create({
        trigger:scrollContainer, start:"top top", end:"bottom bottom", scrub:.5,
        onUpdate: self => { wrap.style.opacity = (self.progress>=eAt && self.progress<=lAt) ? 1 : 0; }
      });
    });
  }

  // Scene veil
  function initSceneVeil() {
    const veil = $("#dark-overlay");
    if(!veil)return;
    const ss = t => t*t*(3-2*t);
    ScrollTrigger.create({
      trigger:scrollContainer, start:"top top", end:"bottom bottom", scrub:.5,
      onUpdate: self => {
        const p = self.progress;
        let o;
        if(p<.04) o=0;
        else if(p<.16) o=ss((p-.04)/.12)*.78;
        else o=.78;
        veil.style.opacity=o;
      }
    });
  }

  // Theme transitions
  function initTheme() {
    const sections = $$(".scroll-section[data-theme]").map(s => ({
      el:s, enter:parseFloat(s.dataset.enter)/100, leave:parseFloat(s.dataset.leave)/100, theme:s.dataset.theme
    })).sort((a,b)=>a.enter-b.enter);
    let active = "dark";
    ScrollTrigger.create({
      trigger:scrollContainer, start:"top top", end:"bottom bottom", scrub:.5,
      onUpdate: self => {
        const p = self.progress;
        let next = active;
        for(const s of sections){
          if(p>=s.enter&&p<=s.leave){next=s.theme;break}
          if(p<s.enter) break;
          next=s.theme;
        }
        if(next!==active){active=next;document.documentElement.setAttribute("data-active-theme",next)}
      }
    });
  }

  // Progress indicator
  function initProgress() {
    const sections = $$(".scroll-section").map(s => ({
      enter:parseFloat(s.dataset.enter), leave:parseFloat(s.dataset.leave),
      label:(s.querySelector(".section-label")?.textContent||"").trim()
    })).sort((a,b)=>a.enter-b.enter);
    let activeLabel = "";
    ScrollTrigger.create({
      trigger:scrollContainer, start:"top top", end:"bottom bottom", scrub:.5,
      onUpdate: self => {
        const pct = self.progress*100;
        progressFill.style.height = pct+"%";
        progressLabel.style.top = pct+"%";
        let nl = activeLabel;
        for(const s of sections){
          if(pct>=s.enter&&pct<=s.leave){nl=s.label;break}
          if(pct<s.enter) break;
          nl=s.label;
        }
        if(nl!==activeLabel){activeLabel=nl;progressLabel.textContent=nl}
      }
    });
  }

  function initNav() {
    const nav = $("#site-nav");
    const toggle = $("#nav-toggle");
    const links = $("#nav-links");
    if (!nav) return;
    window.addEventListener("scroll", () => {
      nav.classList.toggle("scrolled", window.scrollY > 60);
    }, { passive: true });
    if (toggle && links) {
      toggle.addEventListener("click", () => {
        toggle.classList.toggle("active");
        links.classList.toggle("open");
      });
      links.querySelectorAll("a").forEach(a => {
        a.addEventListener("click", () => {
          toggle.classList.remove("active");
          links.classList.remove("open");
        });
      });
    }
  }

  function initEngine() {
    initLenis();
    initNav();
    initHero();
    initHeroTransition();
    $$(".scroll-section").forEach(setupSection);
    initCounters();
    initMarquee();
    initSceneVeil();
    initTheme();
    initProgress();
    window.addEventListener("resize", () => { resizeCanvas(); if(heroImage) drawImage(heroImage, 0); });
  }

  preload();
})();
${'<'}/script>
</body>
</html>`;
}
