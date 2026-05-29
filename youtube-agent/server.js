import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename_init = fileURLToPath(import.meta.url);
const __dirname_init = path.dirname(__filename_init);
dotenv.config({ path: path.join(__dirname_init, '.env') });
import { execFile } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, 'output')));

const PORT = process.env.PORT || 3003;
const OUTPUT_DIR = path.join(__dirname, 'output');

['images', 'audio', 'video', 'thumbnails', 'bgm', 'srt', 'clips'].forEach(dir => {
  fs.mkdirSync(path.join(OUTPUT_DIR, dir), { recursive: true });
});

// ========================
// API Clients
// ========================
let anthropic, openai;

try { anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); } catch(e) { console.warn('Anthropic API 미설정'); }
try { openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); } catch(e) { console.warn('OpenAI API 미설정'); }

// YouTube OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI || `http://localhost:${PORT}/api/youtube/callback`
);

let youtubeTokens = null;
const TOKEN_PATH = path.join(__dirname, '.youtube-tokens.json');

if (process.env.YOUTUBE_REFRESH_TOKEN) {
  youtubeTokens = { refresh_token: process.env.YOUTUBE_REFRESH_TOKEN };
  oauth2Client.setCredentials(youtubeTokens);
} else if (fs.existsSync(TOKEN_PATH)) {
  try {
    youtubeTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(youtubeTokens);
  } catch(e) {}
}

// ========================
// Project State
// ========================
const projects = {};

function getProject(id) {
  if (!projects[id]) {
    projects[id] = {
      id,
      topic: '',
      target: '',
      plan: '',
      script: '',
      scenes: [],
      imageFiles: [],
      audioFiles: [],
      videoFile: null,
      meta: {},
      createdAt: new Date().toISOString()
    };
  }
  return projects[id];
}

// ========================
// Health Check
// ========================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apis: {
      claude: !!process.env.ANTHROPIC_API_KEY,
      dalle: !!process.env.OPENAI_API_KEY,
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      youtube: !!process.env.YOUTUBE_CLIENT_ID
    },
    ffmpeg: true
  });
});

// ========================
// 0. YouTube 트렌드
// ========================
app.get('/api/youtube/trending', async (req, res) => {
  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const response = await youtube.videos.list({
      part: 'snippet,statistics',
      chart: 'mostPopular',
      regionCode: 'KR',
      maxResults: 12
    });

    const trends = response.data.items.map(v => ({
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      views: parseInt(v.statistics.viewCount || 0),
      category: v.snippet.categoryId,
      thumbnail: v.snippet.thumbnails?.medium?.url
    }));

    res.json({ success: true, trends });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 1. 주제 추천 (Claude)
// ========================
app.post('/api/topics/suggest', async (req, res) => {
  try {
    const { category, target, keyword, categories } = req.body;
    const catList = categories || 'history,science,ai,mystery,economy,psychology,nature,crime,culture,philosophy,health';

    const prompt = `당신은 100만 구독자를 보유한 전문 유튜브 채널 기획자입니다.

다음 조건에 맞는 유튜브 롱폼 영상 주제 6개를 추천해주세요:
- 카테고리: ${category || '자유 (다양한 카테고리에서 골고루)'}
- 타겟 시청자: ${target || '전 연령'}
${keyword ? `- 관련 키워드: ${keyword}` : ''}

category 필드는 반드시 다음 중 하나를 사용하세요: ${catList}

각 주제마다 다음 JSON 형식으로 작성해주세요:
[
  {
    "title": "영상 제목 (클릭을 유도하는 매력적인 제목)",
    "description": "2줄 설명",
    "estimatedViews": "예상 조회수 (예: 50만+)",
    "difficulty": "하/중/상",
    "category": "위 카테고리 목록 중 하나",
    "target": "가장 적합한 타겟 시청자 (다음 중 정확히 하나만 선택: 10대, 20대, 30대, 40대, 50대 이상, 전 연령)",
    "keywords": ["키워드1", "키워드2", "키워드3"]
  }
]

JSON 배열만 반환하세요. 다른 텍스트 없이.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const topics = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    res.json({ success: true, topics });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 2. 대본 기획 (Claude)
// ========================
app.post('/api/plan/generate', async (req, res) => {
  try {
    const { projectId, topic, target, length, tone, style, notes } = req.body;
    const project = getProject(projectId);
    project.topic = topic;
    project.target = target;

    const prompt = `당신은 100만 구독자를 보유한 전문 유튜브 영상 기획자입니다.

다음 주제로 유튜브 롱폼 영상 기획안을 작성해주세요:

[주제]: ${topic}
[타겟 시청자]: ${target || '전 연령'}
[영상 길이]: 약 ${length || 15}분
[톤앤매너]: ${tone || '진지하고 무게감 있는'}
[비주얼 스타일]: ${style || '유럽풍 애니메이션'}
${notes ? `[특별 요청]: ${notes}` : ''}

기획안에 다음을 포함해주세요:
1. 영상 구조 (기승전결): 오프닝(후킹) - 서론 - 본론1 - 본론2 - 클라이맥스 - 결론(CTA)
   각 파트마다 시간 배분, 핵심 내용, 연출 포인트를 구체적으로 작성
2. 장면 구성: 8~10개 장면의 비주얼 설명
3. Fact-Check 체크리스트
4. 참고 자료/출처 가이드

전문적이고 상세한 기획안을 작성해주세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const plan = message.content[0].text;
    project.plan = plan;

    res.json({ success: true, plan });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 3. 대본 생성 (Claude)
// ========================
app.post('/api/script/generate', async (req, res) => {
  try {
    const { projectId, topic, target, wordCount, narration, plan, tone } = req.body;
    const project = getProject(projectId);

    const prompt = `당신은 100만 구독자를 보유한 전문 유튜브 대본 작가입니다.

다음 정보를 바탕으로 유튜브 롱폼 영상 대본을 작성해주세요:

[주제]: ${topic || project.topic}
[타겟 시청자]: ${target || project.target || '전 연령'}
[대본 분량]: 약 ${wordCount || 3000}자
[나레이션 스타일]: ${narration || '3인칭 나레이터'}
[톤앤매너]: ${tone || '진지하고 무게감 있는'}

${plan || project.plan ? `[기획안 참고]:\n${(plan || project.plan).substring(0, 2000)}` : ''}

대본 작성 규칙:
1. 구조: 오프닝(강력한 후킹) → 서론 → 본론 → 클라이맥스 → 결론(CTA)
2. Fact-Check: 실제 역사적 사실/검증된 데이터만 사용
3. 각 장면을 [장면 1: 제목 | 이미지: 비주얼 묘사] 형식으로 구분 (이미지 묘사는 반드시 [] 대괄호 안에만 포함)
4. 톤/감정 지시문 금지: "(차분하게)", "(긴장감 있게)" 같은 연출 지시는 절대 작성 금지 (TTS가 그대로 읽음)
5. CTA: 마지막에 자연스러운 좋아요/구독 요청
6. 절대 금지: "이미지:", "▶ 이미지:", "배경:", "효과음:", "음악:", "BGM:", "화면:", "자막:", "카메라:", "샷:", "비주얼:", "영상:" 같은 메타 라벨을 나레이션 본문이나 별도 줄에 작성하지 마세요. 비주얼 정보는 오직 [장면 N: 제목 | 이미지: 묘사] 헤더 안에만 포함하세요.
7. 진행/연출 지시문 절대 금지 (TTS가 그대로 읽으면 안 됨):
   - "잠시 멈춤", "잠깐 멈춤", "짧은 정적", "긴 침묵", "정적이 흐른다", "침묵", "한 박자 쉼", "호흡", "긴 호흡"
   - "(pause)", "[pause]", "...", "음악 페이드인", "음악 페이드아웃", "BGM 시작", "효과음", "톤 다운"
   - "화면 전환", "컷 전환", "다음 장면으로", "여기서 잠깐"
   - 위 종류 표현은 괄호/대괄호 포함 어떤 형식으로도 본문에 쓰지 마세요.
8. 절대 문장을 "..." 으로 생략하지 마세요. 모든 문장은 반드시 완전하게 끝맺어야 합니다.
9. "~것을...", "~했다는..." 같은 미완성 문장은 금지합니다. 마지막 문장까지 완결된 형태로 작성하세요.
10. 나레이션 본문은 시청자가 들을 음성 텍스트만 작성하세요. 화면 설명/시각 효과 지시/자막 안내/연출 지시/감정 톤 지시는 절대 본문에 쓰지 마세요.

${wordCount || 3000}자 이상의 완성된 대본을 작성해주세요. 절대 중간에 끊기지 않도록 끝까지 완성하세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }]
    });

    const script = message.content[0].text;
    project.script = script;

    const sceneMatches = script.match(/\[장면\s*\d+[^\]]*\]/g) || [];
    project.scenes = sceneMatches.map(s => s.replace(/[\[\]]/g, ''));

    res.json({ success: true, script, sceneCount: project.scenes.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 4. 이미지 생성 (ChatGPT Images 2.0)
// ========================
app.post('/api/images/generate', async (req, res) => {
  try {
    const { projectId, prompt, style, index, ratio } = req.body;

    const sizeMap = {
      '16:9': '1536x1024',
      '9:16': '1024x1536',
      '1:1': '1024x1024'
    };

    const stylePrefix = {
      // 시네마틱·포토리얼
      'realistic': 'photorealistic, hyper-detailed, 8K resolution, cinematic lighting, sharp focus,',
      'cinematic': 'cinematic concept art, dramatic lighting, film grain, wide aspect ratio,',
      'documentary': 'documentary photography style, candid moment, natural lighting, realistic colors, photojournalism,',
      'hyperrealistic': 'hyperrealistic rendering, ultra-detailed textures, lifelike skin and materials, professional photography,',
      'film-noir': 'film noir style, black and white, high contrast shadows, dramatic chiaroscuro lighting, 1940s atmosphere,',
      'vintage-film': 'vintage film aesthetic, faded colors, grainy texture, retro 1970s look, nostalgic mood,',

      // 일러스트·애니메이션
      'european-animation': 'European animation style, Ghibli-inspired, soft lighting, painterly textures,',
      'anime': 'Japanese anime style, vibrant colors, expressive characters, clean line art, cel-shaded,',
      'pixar-3d': 'Pixar 3D animation style, vibrant lighting, expressive character design, soft global illumination,',
      'ghibli': 'Studio Ghibli style, lush hand-painted backgrounds, whimsical atmosphere, soft watercolor textures,',
      'comic-book': 'American comic book style, bold outlines, halftone shading, dynamic action poses, vibrant colors,',
      'manga': 'Japanese manga style, black ink linework, screen tones, dramatic panel composition, expressive eyes,',
      'storybook': 'childrens storybook illustration, gentle watercolor, soft pastel tones, whimsical hand-drawn quality,',

      // 회화·예술
      'watercolor': 'watercolor painting style, soft edges, flowing colors, paper texture,',
      'oil-painting': 'classical oil painting style, rich colors, Renaissance-inspired, visible brushstrokes,',
      'pencil-sketch': 'detailed pencil sketch, graphite shading, fine cross-hatching, monochrome, hand-drawn artistry,',
      'ink-painting': 'East Asian ink wash painting, sumi-e style, monochromatic brushwork, minimal composition, atmospheric,',
      'impressionist': 'Impressionist painting style, visible brushstrokes, dappled light, Monet-inspired color palette,',
      'renaissance': 'Renaissance painting style, classical composition, chiaroscuro lighting, Da Vinci or Caravaggio inspired,',
      'ukiyo-e': 'Japanese ukiyo-e woodblock print style, flat color planes, bold outlines, Edo period aesthetic,',

      // 콘셉트·판타지
      'fantasy-art': 'epic fantasy concept art, magical atmosphere, ethereal lighting, painterly digital art,',
      'sci-fi': 'science fiction concept art, futuristic technology, atmospheric lighting, cinematic sci-fi aesthetic,',
      'cyberpunk': 'cyberpunk aesthetic, neon-lit streets, rainy night, holographic signs, blade runner style,',
      'steampunk': 'steampunk Victorian aesthetic, brass and copper machinery, gears and steam, retro-futuristic,',
      'dark-fantasy': 'dark fantasy art, gothic atmosphere, moody shadows, Frazetta inspired, epic scale,',
      'surreal': 'surrealist art, dreamlike composition, Salvador Dali inspired, impossible perspective, symbolic imagery,',

      // 그래픽·디자인
      'minimalist': 'minimalist design, clean composition, limited color palette, negative space, modern aesthetic,',
      'flat-design': 'flat design illustration, solid colors, no gradients, geometric shapes, modern UI style,',
      'vector-art': 'clean vector art, sharp lines, smooth gradients, illustrator style,',
      'pixel-art': '16-bit pixel art, retro video game aesthetic, limited color palette, detailed pixel work,',
      'low-poly': 'low poly 3D art, geometric facets, flat shading, isometric perspective, modern minimalist 3D,',
      'isometric': 'isometric illustration, 2.5D perspective, clean geometry, vibrant colors, infographic style,'
    };

    const fullPrompt = `${stylePrefix[style] || ''} ${prompt}. High quality, detailed, professional.`;

    const image = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: fullPrompt,
      size: sizeMap[ratio] || '1536x1024',
      quality: 'high',
      n: 1
    });

    const b64 = image.data[0].b64_json;
    const buffer = Buffer.from(b64, 'base64');
    const filename = `scene_${index || Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, 'images', filename);
    fs.writeFileSync(filepath, buffer);

    const project = getProject(projectId);
    project.imageFiles.push({ index, filename, filepath, prompt: fullPrompt });

    res.json({
      success: true,
      imageUrl: `/output/images/${filename}`,
      filename
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/images/generate-prompts', async (req, res) => {
  try {
    const { projectId, script, style, count } = req.body;
    const project = getProject(projectId);

    const fullScript = script || project.script || '';
    const sceneCount = parseInt(count) || 8;

    const prompt = `다음 유튜브 영상 대본을 꼼꼼히 읽고, 대본 내용에 정확히 맞는 ${sceneCount}개 장면의 이미지 생성 프롬프트를 영어로 작성하세요.

대본:
${fullScript.substring(0, 8000)}

중요 규칙:
1. 대본의 [장면 N: 제목 | 이미지: 묘사] 헤더 구조를 반드시 참고하여 해당 장면의 내용을 정확히 반영하세요.
2. 대본에 언급된 구체적인 인물, 장소, 사건, 시대를 프롬프트에 포함하세요.
3. 대본 순서대로 장면을 배치하세요 (오프닝 → 본론 → 클라이맥스 → 엔딩).
4. 각 프롬프트는 50단어 이상, 배경/조명/분위기/구도를 구체적으로 묘사하세요.
5. search_keywords: Pexels 스톡 영상 검색에 최적화된 짧은 영문 키워드 2~3단어. 다음 규칙 준수:
   - 구체적이고 일반적인 명사 위주
   - 한국 고유명사·추상명사 금지
   - 가능하면 최신 사회 반영 (현대 도시·기술·라이프스타일·소셜미디어·디지털 환경 등)
   - 각 장면마다 서로 다른 키워드 사용 (중복 영상 회피)
   - 예: "modern city skyline", "smartphone user", "remote work laptop", "diverse team meeting", "AI technology lab", "young professional cafe", "drone city aerial", "neon street night"
6. 반드시 ${sceneCount}개를 모두 생성하세요.

스타일: ${style || 'european-animation'}
모든 이미지가 일관된 스타일을 유지하도록 프롬프트를 작성하세요.

JSON 배열 형식으로만 반환:
[{"scene":1,"name":"장면 이름 (한국어)","prompt":"영어 이미지 프롬프트","search_keywords":"english search terms"}]`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const prompts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    res.json({ success: true, prompts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 5. TTS 생성 (ElevenLabs)
// ========================
app.post('/api/tts/generate', async (req, res) => {
  try {
    const { projectId, text, voiceId, index, stability, similarity } = req.body;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ElevenLabs API 키가 설정되지 않았습니다');

    const vid = voiceId || 'pNInz6obpgDQGcFmaJgB'; // default: Adam

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: stability || 0.5,
          similarity_boost: similarity || 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs 오류: ${response.status} - ${err}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const filename = `narration_${index || Date.now()}.mp3`;
    const filepath = path.join(OUTPUT_DIR, 'audio', filename);
    fs.writeFileSync(filepath, audioBuffer);

    const project = getProject(projectId);
    project.audioFiles.push({ index, filename, filepath });

    res.json({
      success: true,
      audioUrl: `/output/audio/${filename}`,
      filename
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tts/full-script', async (req, res) => {
  try {
    const { projectId, script, voiceId, stability, similarity } = req.body;
    const project = getProject(projectId);

    // 메타 라벨 키워드 통합 패턴
    const META_LABELS = '(?:이미지|배경|장면|효과음|음악|BGM|bgm|배경음악|자막|화면|카메라|컷|전환|샷|shot|비주얼|visual|영상|화면설명|시각효과|VFX|sfx|SFX)';
    const cleanScript = (script || project.script || '')
      .replace(/\[장면[^\]]*\]/g, '')
      .replace(/\[영상[^\]]*\]/g, '')
      .replace(/\[(?:오프닝|엔딩|인트로|아웃트로|마무리|시작|종료|끝)[^\]]*\]/gi, '')
      // markdown bold 래핑 제거 (**이미지**, __이미지__)
      .replace(new RegExp(`(?:\\*{1,2}|_{1,2})\\s*${META_LABELS}\\s*(?:\\*{1,2}|_{1,2})\\s*[:：][^\\n]*`, 'gim'), '')
      // 라인 단위 메타 라벨 (화살표/꺾쇠/대괄호 prefix 허용)
      .replace(new RegExp(`^\\s*[▶▷►▪■◆◇★☆◎●○•\\-\\*]?\\s*[<\\[\\(]?\\s*${META_LABELS}\\s*[>\\]\\)]?\\s*[:：].*$`, 'gim'), '')
      // 라인 중간 인라인 메타 라벨 (화살표 뒤)
      .replace(new RegExp(`[▶▷►▪■◆◇★☆◎●○]\\s*${META_LABELS}\\s*[:：][^\\n]*`, 'gi'), '')
      // 문장 중간에 끼어든 "이미지: ..." (문장부호 직후)
      .replace(new RegExp(`[.!?。！？]\\s*${META_LABELS}\\s*[:：][^.!?。！？\\n]*[.!?。！？]?`, 'gi'), m => m[0])
      // 나레이터 라벨
      .replace(/\*{0,2}나레이터\*{0,2}\s*\([^)]*\)\s*[:：]\s*/g, '')
      .replace(/\*{0,2}(?:나레이터|내레이터|해설|화자)\*{0,2}\s*[:：]\s*/g, '')
      // 톤/감정 지시문 (괄호/대괄호)
      .replace(/\([^)]*(?:톤|tone|하게|으로|있게|이듯|하며|차분|진지|긴장|단호|침착|격앙|흥분|밝게|어둡게|천천히|빠르게|강하게|부드럽게)[^)]*\)/gi, '')
      .replace(/\[[^\]]*(?:톤|tone|차분|진지|긴장|단호|침착|격앙|흥분)[^\]]*\]/gi, '')
      // 진행/연출 지시문 (괄호/대괄호 + 본문 단독)
      .replace(/\([^)]*(?:잠시|잠깐|짧은|긴)\s*(?:멈춤|침묵|정적|호흡|쉼|쉬다)[^)]*\)/gi, '')
      .replace(/\([^)]*(?:정적이?\s*흐른다|침묵이?\s*흐른다|한\s*박자|호흡\s*가다듬|숨\s*고르)[^)]*\)/gi, '')
      .replace(/\([^)]*(?:pause|silence|beat)[^)]*\)/gi, '')
      .replace(/\[[^\]]*(?:잠시|잠깐|짧은|긴)\s*(?:멈춤|침묵|정적|호흡|쉼)[^\]]*\]/gi, '')
      .replace(/\[[^\]]*(?:pause|silence|beat)[^\]]*\]/gi, '')
      // 본문 단독 진행 지시문 (앞뒤 공백/문장부호로 격리)
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:잠시|잠깐)\s*(?:멈춤|멈춥니다|정적|침묵|쉼|쉬어|쉬고)\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:짧은|긴)\s*(?:정적|침묵|호흡)이?\s*(?:흐른다|흐릅니다)?\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:한\s*박자\s*쉼|호흡\s*가다듬|숨\s*고르기|숨\s*고르고)\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      .replace(/(?:^|[\s.,!?。！？\n])\s*(?:화면\s*전환|컷\s*전환|다음\s*장면(?:으로|에서))\.?(?=\s|$|[.,!?。！？\n])/g, ' ')
      // 메타 정보
      .replace(/^.*총\s*글자\s*수\s*[:：].*$/gm, '')
      .replace(/^.*총\s*분량\s*[:：].*$/gm, '')
      .replace(/^.*예상\s*시간\s*[:：].*$/gm, '')
      // 구분선/마크다운
      .replace(/^---+$/gm, '')
      .replace(/^===+$/gm, '')
      .replace(/^#+\s.*$/gm, '')
      .replace(/^[-*]\s/gm, '')
      .replace(/\*{2,}/g, '')
      .replace(/[━═─■●•🎙️🎬📌🔹✅☐▶▷►🎵🎶⚡⏩]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const vid = voiceId || 'pNInz6obpgDQGcFmaJgB';
    const voiceSettings = {
      stability: stability || 0.5,
      similarity_boost: similarity || 0.75,
      style: 0.3,
      use_speaker_boost: true
    };

    const CHUNK_LIMIT = 4800;

    async function generateTTSChunk(text) {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: voiceSettings })
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`ElevenLabs 오류: ${response.status} - ${err}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    // with-timestamps: 각 글자별 실제 시작/끝 시각 받아 SRT 정확도 향상
    async function generateTTSChunkWithTimestamps(text) {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/with-timestamps`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: voiceSettings })
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`ElevenLabs with-timestamps 오류: ${response.status} - ${err}`);
      }
      const data = await response.json();
      // data: { audio_base64, alignment: { characters: [...], character_start_times_seconds: [...], character_end_times_seconds: [...] } }
      const audio = Buffer.from(data.audio_base64, 'base64');
      const alignment = data.alignment || data.normalized_alignment || null;
      return { audio, alignment };
    }

    function splitTextIntoChunks(text, limit) {
      if (text.length <= limit) return [text];
      const chunks = [];
      let remaining = text;
      while (remaining.length > 0) {
        if (remaining.length <= limit) { chunks.push(remaining); break; }
        let splitIdx = remaining.lastIndexOf('. ', limit);
        if (splitIdx < limit * 0.3) splitIdx = remaining.lastIndexOf('。', limit);
        if (splitIdx < limit * 0.3) splitIdx = remaining.lastIndexOf('\n', limit);
        if (splitIdx < limit * 0.3) splitIdx = remaining.lastIndexOf(' ', limit);
        if (splitIdx < limit * 0.3) splitIdx = limit;
        chunks.push(remaining.substring(0, splitIdx + 1).trim());
        remaining = remaining.substring(splitIdx + 1).trim();
      }
      return chunks.filter(c => c.length > 0);
    }

    const chunks = splitTextIntoChunks(cleanScript, CHUNK_LIMIT);
    const timestamp = Date.now();

    // 글자별 정확한 timing 누적 (with-timestamps API 결과)
    const globalAlignment = { characters: [], starts: [], ends: [] };
    let cumulativeOffset = 0;

    if (chunks.length === 1) {
      const { audio, alignment } = await generateTTSChunkWithTimestamps(chunks[0]);
      const filename = `full_narration_${timestamp}.mp3`;
      fs.writeFileSync(path.join(OUTPUT_DIR, 'audio', filename), audio);
      if (alignment && alignment.characters) {
        globalAlignment.characters = alignment.characters;
        globalAlignment.starts = alignment.character_start_times_seconds || [];
        globalAlignment.ends = alignment.character_end_times_seconds || [];
      }
      project.audioFiles = [{ index: 0, filename, filepath: path.join(OUTPUT_DIR, 'audio', filename), full: true }];
      project.ttsAlignment = globalAlignment.characters.length > 0 ? globalAlignment : null;
      return res.json({ success: true, audioUrl: `/output/audio/${filename}`, filename, charCount: cleanScript.length, chunks: 1, hasTimestamps: !!project.ttsAlignment });
    }

    const chunkFiles = [];
    for (let i = 0; i < chunks.length; i++) {
      const { audio, alignment } = await generateTTSChunkWithTimestamps(chunks[i]);
      const chunkFile = `chunk_${timestamp}_${i}.mp3`;
      fs.writeFileSync(path.join(OUTPUT_DIR, 'audio', chunkFile), audio);
      chunkFiles.push(chunkFile);

      // alignment 누적: 청크별 시작 offset 적용
      if (alignment && alignment.characters) {
        const chars = alignment.characters || [];
        const starts = alignment.character_start_times_seconds || [];
        const ends = alignment.character_end_times_seconds || [];
        for (let j = 0; j < chars.length; j++) {
          globalAlignment.characters.push(chars[j]);
          globalAlignment.starts.push(starts[j] + cumulativeOffset);
          globalAlignment.ends.push(ends[j] + cumulativeOffset);
        }
        // 청크 끝 시간 = 마지막 글자 종료 + 약간 buffer (concat 시 이어 붙음)
        cumulativeOffset += ends[ends.length - 1] || 0;
      }

      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[TTS] 누적 alignment ${globalAlignment.characters.length}자, 총 ${cumulativeOffset.toFixed(2)}초`);

    const concatList = chunkFiles.map(f => `file '${path.join(OUTPUT_DIR, 'audio', f).replace(/\\/g, '/')}'`).join('\n');
    const concatFile = path.join(OUTPUT_DIR, 'audio', `concat_${timestamp}.txt`);
    fs.writeFileSync(concatFile, concatList);

    const filename = `full_narration_${timestamp}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, 'audio', filename);

    // 청크 결합 — re-encode로 stream copy 오정렬 방지
    // 수정 이력:
    //   - 이전 버그 1: afade=t=out:st=0 → 각 청크 처음 5ms를 페이드아웃시켜 클릭 잡음 발생
    //   - 이전 버그 2: 250ms silence 패딩 → SRT가 silence 구간까지 텍스트에 분배해서 누적 드리프트
    //   - 수정: silence 패딩 제거, afade out 제거, afade in 20ms만 유지
    //   - TTS 자체 마침표/쉼표 pause 있어 자연스러움. 청크 경계 click은 aformat 재인코딩으로 해결.
    const inputArgs = [];
    chunkFiles.forEach(f => { inputArgs.push('-i', path.join(OUTPUT_DIR, 'audio', f)); });

    const filterParts = [];
    chunkFiles.forEach((_, i) => {
      // 샘플레이트/채널/포맷 통일 + 청크 시작 20ms 페이드인 (클릭 방지)
      filterParts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,afade=t=in:st=0:d=0.02[a${i}]`);
    });
    const concatInputs = chunkFiles.map((_, i) => `[a${i}]`);
    const concatN = concatInputs.length;
    filterParts.push(`${concatInputs.join('')}concat=n=${concatN}:v=0:a=1[out]`);
    const filterComplex = filterParts.join(';');

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100',
        '-y', outputPath
      ], { timeout: 180000 }, (error, stdout, stderr) => {
        if (error) {
          // Fallback: concat demuxer + re-encode (필터 실패 시)
          console.error('[TTS concat filter 실패, fallback]', error.message);
          execFile('ffmpeg', [
            '-f', 'concat', '-safe', '0', '-i', concatFile,
            '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100',
            '-y', outputPath
          ], { timeout: 120000 }, (e2) => { if (e2) reject(e2); else resolve(); });
        } else resolve();
      });
    });

    chunkFiles.forEach(f => { try { fs.unlinkSync(path.join(OUTPUT_DIR, 'audio', f)); } catch(e) {} });
    try { fs.unlinkSync(concatFile); } catch(e) {}

    project.audioFiles = [{ index: 0, filename, filepath: outputPath, full: true }];
    project.ttsAlignment = globalAlignment.characters.length > 0 ? globalAlignment : null;

    res.json({
      success: true, audioUrl: `/output/audio/${filename}`, filename,
      charCount: cleanScript.length, chunks: chunks.length,
      hasTimestamps: !!project.ttsAlignment
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tts/voices', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });
    const data = await response.json();
    const voices = data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
      previewUrl: v.preview_url || null
    }));
    res.json({ success: true, voices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tts/sample', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const { voiceId, text } = req.body;
    if (!text || !voiceId) throw new Error('voiceId와 text 필요');
    const sampleText = text.slice(0, 200);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: sampleText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
    if (!response.ok) throw new Error(`ElevenLabs: ${response.status}`);
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
    res.send(audioBuffer);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 5-1. SRT 자막 생성
// ========================
app.post('/api/srt/generate', async (req, res) => {
  try {
    const { projectId, script, duration } = req.body;
    const project = getProject(projectId);
    const text = script || project.script || '';
    if (!text) throw new Error('대본이 없습니다');

    // 오디오 mtime 최신 파일 선택 후 길이 측정
    let audioDuration = 0;
    const audioFiles = fs.existsSync(path.join(OUTPUT_DIR, 'audio'))
      ? fs.readdirSync(path.join(OUTPUT_DIR, 'audio'))
          .filter(f => f.endsWith('.mp3'))
          .map(f => ({ f, m: fs.statSync(path.join(OUTPUT_DIR, 'audio', f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)
          .map(o => o.f)
      : [];
    const audioFile = audioFiles.find(f => f.startsWith('full_')) || audioFiles[0];
    if (audioFile) {
      audioDuration = await probeDuration(path.join(OUTPUT_DIR, 'audio', audioFile));
    }

    const totalDur = audioDuration > 0 ? audioDuration : (duration || 120);
    const srtContent = scriptToSrt(text, totalDur, 0, project.ttsAlignment);

    const filename = `subtitles_${Date.now()}.srt`;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'srt', filename), srtContent, 'utf-8');

    res.json({
      success: true,
      srtUrl: `/output/srt/${filename}`,
      filename,
      subtitleCount: srtContent.split('\n\n').filter(Boolean).length,
      preview: srtContent.substring(0, 500),
      audioDuration: totalDur
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/output/srt', express.static(path.join(OUTPUT_DIR, 'srt')));
app.use('/output/clips', express.static(path.join(OUTPUT_DIR, 'clips')));

// ========================
// 6. 영상 클립 생성 (Pexels 스톡 영상)
// ========================
// Pexels API로 장면별 키워드 영상 검색 후 다운로드
app.post('/api/clips/generate', async (req, res) => {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error('PEXELS_API_KEY가 설정되지 않았습니다. .env 파일에 추가하세요. (무료 발급: https://www.pexels.com/api/)');

    const { projectId, scenePrompts, perSceneDuration } = req.body;
    const project = getProject(projectId);
    const prompts = scenePrompts || project.scenePrompts || [];
    if (!prompts.length) throw new Error('장면 프롬프트가 없습니다. 먼저 프롬프트를 생성하세요.');

    // 기존 clip 파일 정리
    fs.readdirSync(path.join(OUTPUT_DIR, 'clips'))
      .filter(f => f.startsWith('clip_') && f.endsWith('.mp4'))
      .forEach(f => { try { fs.unlinkSync(path.join(OUTPUT_DIR, 'clips', f)); } catch(e) {} });

    const targetDur = perSceneDuration || 10;
    const clips = [];

    // 사용된 video id 추적 — 중복 방지
    const usedVideoIds = new Set();
    // 최신 사회 반영 키워드 풀 (랜덤 변형)
    const MODERN_MODIFIERS = ['modern', 'contemporary', '2024', 'urban', 'cinematic', 'professional'];

    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      // search_keywords 우선, 없으면 prompt 앞부분 영문만 추출
      let baseQuery;
      if (p.search_keywords && typeof p.search_keywords === 'string') {
        baseQuery = p.search_keywords.trim().substring(0, 50);
      } else {
        // 영문 단어만 추출 (한글 제거), 첫 3~5단어
        const englishWords = (p.prompt || '').match(/[a-zA-Z]+/g) || [];
        baseQuery = englishWords.slice(0, 4).join(' ').substring(0, 50);
        if (!baseQuery) baseQuery = (p.name || 'nature landscape').replace(/[^a-zA-Z\s]/g, ' ').trim();
      }
      // 최신 사회 반영: 장면 index 기반 modifier 추가 (다양성 + 중복 방지)
      const modifier = MODERN_MODIFIERS[i % MODERN_MODIFIERS.length];
      const query = `${baseQuery} ${modifier}`.substring(0, 70);
      console.log(`[Pexels] 장면 ${i+1} 검색: "${query}"`);
      try {
        // per_page 15로 늘려 중복 회피 여지 확보
        const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`;
        const r = await fetch(searchUrl, { headers: { Authorization: apiKey } });
        if (!r.ok) throw new Error(`Pexels API ${r.status}`);
        const data = await r.json();
        let videos = data.videos || [];

        // 이미 사용된 video id 제외
        videos = videos.filter(v => !usedVideoIds.has(v.id));

        // 다 사용됐으면 modifier 다른 걸로 fallback 검색
        if (!videos.length) {
          const altModifier = MODERN_MODIFIERS[(i + 3) % MODERN_MODIFIERS.length];
          const altQuery = `${baseQuery} ${altModifier}`.substring(0, 70);
          console.log(`[Pexels] 장면 ${i+1} 재검색(중복 회피): "${altQuery}"`);
          const r2 = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(altQuery)}&per_page=15&orientation=landscape`, { headers: { Authorization: apiKey } });
          if (r2.ok) {
            const d2 = await r2.json();
            videos = (d2.videos || []).filter(v => !usedVideoIds.has(v.id));
          }
        }
        if (!videos.length) {
          clips.push({ index: i + 1, error: 'no result', query });
          continue;
        }

        // HD 720p~1080p 우선
        const video = videos[0];
        usedVideoIds.add(video.id);
        const files = video.video_files || [];
        const hd = files.find(f => f.width >= 1280 && f.width <= 1920 && f.file_type === 'video/mp4')
                || files.find(f => f.file_type === 'video/mp4')
                || files[0];
        if (!hd?.link) {
          clips.push({ index: i + 1, error: 'no mp4 file' });
          continue;
        }
        const vRes = await fetch(hd.link);
        if (!vRes.ok) throw new Error(`Download ${vRes.status}`);
        const buffer = Buffer.from(await vRes.arrayBuffer());
        const sceneNum = String(i + 1).padStart(2, '0');
        const filename = `clip_${sceneNum}.mp4`;
        const filepath = path.join(OUTPUT_DIR, 'clips', filename);
        fs.writeFileSync(filepath, buffer);
        clips.push({
          index: i + 1,
          filename,
          url: `/output/clips/${filename}`,
          size: `${(buffer.length / 1024 / 1024).toFixed(1)}MB`,
          query,
          source: 'pexels',
          author: video.user?.name || 'Unknown',
          authorUrl: video.user?.url || ''
        });
        // Rate limit 보호
        await new Promise(r => setTimeout(r, 800));
      } catch(e) {
        clips.push({ index: i + 1, error: e.message, query });
      }
    }

    project.clipFiles = clips.filter(c => c.filename);
    res.json({ success: true, clips });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 클립 목록 조회
app.get('/api/clips/list', (req, res) => {
  const dir = path.join(OUTPUT_DIR, 'clips');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).sort().map(f => ({
    name: f, url: `/output/clips/${f}`,
    size: `${(fs.statSync(path.join(dir, f)).size / 1024 / 1024).toFixed(1)}MB`
  }));
  res.json({ success: true, files });
});
app.use('/output/bgm', express.static(path.join(OUTPUT_DIR, 'bgm')));

// ========================
// 6. 영상 렌더링 (FFmpeg)
// ========================
// 헬퍼: 디렉토리에서 최신 파일 mtime 기준 정렬
function listFilesByMtime(dir, filterFn) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(filterFn)
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(o => o.name);
}

// 헬퍼: FFmpeg로 미디어 길이 측정
async function probeDuration(filePath) {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-i', filePath, '-hide_banner'], { timeout: 10000 }, (error, stdout, stderr) => {
      const match = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (match) resolve(parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/100);
      else resolve(0);
    });
  });
}

// 헬퍼: SRT 시간 형식
function formatSrtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

// 헬퍼: 스크립트 → SRT 변환 (오디오 길이 기반 + 오프셋)
// 메타 라벨 제거 (이미지:, 배경:, 효과음: 등) — 강화 통합 패턴
const META_LABEL_KW = '(?:이미지|배경|장면|효과음|음악|BGM|bgm|배경음악|자막|화면|카메라|컷|전환|샷|shot|비주얼|visual|영상|화면설명|시각효과|VFX|sfx|SFX)';
function stripMetaLabels(text) {
  return text
    // bold/underscore 래핑
    .replace(new RegExp(`(?:\\*{1,2}|_{1,2})\\s*${META_LABEL_KW}\\s*(?:\\*{1,2}|_{1,2})\\s*[:：][^\\n]*`, 'gim'), '')
    // 라인 단위 (prefix 화살표/꺾쇠/대괄호 등 허용)
    .replace(new RegExp(`^\\s*[▶▷►▪■◆◇★☆◎●○•\\-\\*]?\\s*[<\\[\\(]?\\s*${META_LABEL_KW}\\s*[>\\]\\)]?\\s*[:：].*$`, 'gim'), '')
    // 인라인 (화살표 뒤)
    .replace(new RegExp(`[▶▷►▪■◆◇★☆◎●○]\\s*${META_LABEL_KW}\\s*[:：][^\\n]*`, 'gi'), '')
    // 나레이터 라벨
    .replace(/\*{0,2}(?:나레이터|내레이터|해설|화자)\*{0,2}\s*\([^)]*\)\s*[:：]\s*/g, '')
    .replace(/\*{0,2}(?:나레이터|내레이터|해설|화자)\*{0,2}\s*[:：]\s*/g, '');
}

// 긴 문장을 자연스러운 단위(30~35자)로 분할
function splitForSubtitle(sentence, maxLen = 33) {
  const t = sentence.trim();
  if (t.length <= maxLen) return [t];
  const parts = [];
  let remaining = t;
  while (remaining.length > maxLen) {
    // 우선순위: 쉼표/조사 → 공백 → 강제 컷
    let cut = -1;
    const ideal = Math.min(maxLen, remaining.length);
    const minIdx = Math.floor(maxLen * 0.6);
    // 쉼표/마침표/콜론 우선
    for (let i = ideal; i >= minIdx; i--) {
      if (/[,，、:：;；]/.test(remaining[i])) { cut = i + 1; break; }
    }
    // 한국어 조사/어미 뒤 띄어쓰기
    if (cut < 0) {
      for (let i = ideal; i >= minIdx; i--) {
        if (remaining[i] === ' ') { cut = i; break; }
      }
    }
    if (cut < 0) cut = ideal;
    parts.push(remaining.substring(0, cut).trim());
    remaining = remaining.substring(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter(p => p.length > 0);
}

// alignment 기반 SRT (정확): TTS 글자별 실제 timing 사용
// fallback: 글자 비례 분배 (alignment 없을 때)
function scriptToSrt(scriptText, audioDur, offset = 0, alignment = null) {
  const cleaned = stripMetaLabels(scriptText);

  // 자막 단위 추출 (30~35자 청크)
  const subtitleChunks = [];
  const sceneRegex = /\[장면\s*(\d+)[^\]]*\]([\s\S]*?)(?=\[장면|\s*$)/g;
  const scenes = [];
  let m;
  while ((m = sceneRegex.exec(cleaned)) !== null) {
    const c = m[2].replace(/[━═─▶■●•🎙️🎬📌🔹✅☐]/g, '').replace(/\(.*?\)/g, '').replace(/\n{2,}/g, '\n').trim();
    if (c) scenes.push(c);
  }
  if (scenes.length === 0) {
    const ps = cleaned.replace(/\[.*?\]/g, '').replace(/[━═─▶■●•🎙️🎬📌🔹✅☐]/g, '').replace(/\(.*?\)/g, '')
      .split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 10);
    scenes.push(...ps);
  }

  scenes.forEach((scene) => {
    const sentences = scene.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [scene];
    sentences.forEach((sent) => {
      const t = sent.trim();
      if (!t || t.length < 3) return;
      const chunks = splitForSubtitle(t, 33);
      chunks.forEach(c => subtitleChunks.push(c));
    });
  });

  let srt = '';

  // === alignment 기반 정확 매칭 ===
  if (alignment && alignment.characters && alignment.characters.length > 0) {
    const alignChars = alignment.characters;
    const alignStarts = alignment.starts;
    const alignEnds = alignment.ends;
    // alignment의 char 시퀀스를 하나 합친 문자열
    const alignText = alignChars.join('');

    let alignPos = 0; // alignment 안에서 현재 검색 시작 위치
    let idx = 1;

    for (const chunk of subtitleChunks) {
      // chunk 텍스트를 alignment 안에서 위치 찾기
      // 공백·문장부호 무시한 정규화 매칭으로 robust
      const target = chunk.replace(/\s+/g, '').replace(/[.,!?。！？，、:：;；]/g, '');
      if (target.length === 0) continue;

      // alignment text에서 정규화된 위치 찾기
      let normalizedIdx = 0;
      let realStartIdx = -1;
      let realEndIdx = -1;
      let matchedCount = 0;

      for (let i = alignPos; i < alignText.length && matchedCount < target.length; i++) {
        const ch = alignText[i];
        if (/[\s.,!?。！？，、:：;；]/.test(ch)) continue;
        if (ch === target[matchedCount]) {
          if (matchedCount === 0) realStartIdx = i;
          realEndIdx = i;
          matchedCount++;
        } else if (matchedCount > 0) {
          // 매칭 깨짐 → 다시 시작
          matchedCount = 0;
          realStartIdx = -1;
          // i 다시 이전 위치 시도하지 않음 (단순 forward)
        }
      }

      if (realStartIdx >= 0 && realEndIdx >= 0 && realEndIdx < alignStarts.length) {
        const startTime = alignStarts[realStartIdx] + offset;
        const endTime = alignEnds[realEndIdx] + offset;
        const dur = Math.max(0.5, endTime - startTime);
        srt += `${idx}\n${formatSrtTime(startTime)} --> ${formatSrtTime(startTime + dur)}\n${chunk}\n\n`;
        alignPos = realEndIdx + 1;
        idx++;
      } else {
        // 매칭 실패: skip (희귀 케이스)
        console.warn(`[SRT] alignment 매칭 실패: "${chunk.substring(0, 20)}..."`);
      }
    }

    if (srt.length > 0) return srt;
    console.warn('[SRT] alignment 매칭 결과 없음, fallback');
  }

  // === Fallback: 글자 비례 분배 ===
  const totalChars = subtitleChunks.reduce((a, c) => a + c.length, 0) || 1;
  let cur = offset;
  let idx = 1;
  subtitleChunks.forEach((chunk) => {
    const dur = Math.max(0.8, (chunk.length / totalChars) * audioDur);
    srt += `${idx}\n${formatSrtTime(cur)} --> ${formatSrtTime(cur + dur)}\n${chunk}\n\n`;
    cur += dur;
    idx++;
  });
  return srt;
}

app.post('/api/render/video', async (req, res) => {
  try {
    const { projectId, duration, bgmFile, bgmVolume, transition, transitionDuration, burnSrt, showThumb, showIntro, kenburns, sourceMode } = req.body;
    const project = getProject(projectId);

    // 소스 모드: 'image' (기본) / 'video' (Pexels 스톡 영상)
    const useVideo = sourceMode === 'video';
    const sourceDir = useVideo ? 'clips' : 'images';
    const sourcePrefix = useVideo ? 'clip_' : 'scene_';
    const sourceExt = useVideo ? '.mp4' : '.png';

    // 이미지/영상 클립: 파일명 순서대로
    const images = fs.readdirSync(path.join(OUTPUT_DIR, sourceDir))
      .filter(f => f.startsWith(sourcePrefix) && f.endsWith(sourceExt))
      .sort();

    // 오디오: mtime 기준 최신, 'full_' 우선
    const allAudios = listFilesByMtime(path.join(OUTPUT_DIR, 'audio'), f => f.endsWith('.mp3'));
    const audioFile = allAudios.find(f => f.startsWith('full_')) || allAudios[0];

    if (images.length === 0) throw new Error(useVideo
      ? '영상 클립이 없습니다. 먼저 영상 클립을 생성하세요 (/api/clips/generate).'
      : '이미지 파일이 없습니다. 먼저 이미지를 생성하세요.');
    if (!audioFile) throw new Error('오디오 파일이 없습니다. 먼저 TTS를 생성하세요.');

    const audioPath = path.join(OUTPUT_DIR, 'audio', audioFile);
    const audioDuration = await probeDuration(audioPath);
    if (audioDuration <= 0) throw new Error('오디오 길이를 측정할 수 없습니다.');

    console.log(`[Render] 오디오: ${audioFile}, 실제 길이: ${audioDuration.toFixed(2)}초`);

    // 오디오 길이 = 총 영상 길이 (싱크 핵심)
    const totalDuration = audioDuration;
    const transType = transition || 'none';
    const rawTransDur = parseFloat(transitionDuration) || 0.8;

    // === 오디오 끝부분 잘림 방지: xfade 전환 보상 ===
    // xfade 결과 영상 길이 = N*durationPerImage - (N-1)*transDur
    // 이를 audioDuration과 일치시키려면:
    // durationPerImage = (audioDuration + (N-1)*transDur) / N
    // + 1초 여유 버퍼로 오디오 끝까지 보장
    const N = images.length;
    let durationPerImage;
    if (transType !== 'none' && N > 1) {
      const adjustedTotal = totalDuration + 1.0; // 1초 여유
      durationPerImage = (adjustedTotal + (N - 1) * rawTransDur) / N;
    } else {
      durationPerImage = (totalDuration + 1.0) / N;
    }
    const transDur = Math.min(rawTransDur, durationPerImage * 0.4);
    const kbMode = kenburns || 'varied';

    const KB_PATTERNS = [
      { z: "min(zoom+0.0008,1.25)", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
      { z: "if(eq(on,1),1.25,max(zoom-0.0008,1))", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
      { z: "min(zoom+0.0006,1.2)", x: "0", y: "ih/2-(ih/zoom/2)" },
      { z: "min(zoom+0.0006,1.2)", x: "iw/zoom-iw", y: "ih/2-(ih/zoom/2)" },
      { z: "min(zoom+0.0006,1.2)", x: "iw/2-(iw/zoom/2)", y: "0" },
      { z: "min(zoom+0.0006,1.2)", x: "iw/2-(iw/zoom/2)", y: "ih/zoom-ih" },
      { z: "min(zoom+0.0008,1.25)", x: "0", y: "0" },
      { z: "min(zoom+0.0008,1.25)", x: "iw/zoom-iw", y: "ih/zoom-ih" },
    ];

    function getKenBurns(idx, frames) {
      if (kbMode === 'none') return `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      const p = kbMode === 'zoom-in'  ? KB_PATTERNS[0]
              : kbMode === 'zoom-out' ? KB_PATTERNS[1]
              : KB_PATTERNS[idx % KB_PATTERNS.length];
      return `scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='${p.z}':d=${frames}:x='${p.x}':y='${p.y}':s=1920x1080:fps=30`;
    }

    const outputFile = `video_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, 'video', outputFile);

    let ffmpegArgs;

    if (useVideo) {
      // === 비디오 클립 모드: 각 클립을 durationPerImage 길이로 trim/loop, 1080p 스케일, 전환 적용 ===
      const inputArgs = [];
      images.forEach(clip => {
        // 클립이 짧으면 loop, 길면 trim (stream_loop+t로 모두 처리)
        inputArgs.push('-stream_loop', '-1', '-t', String(durationPerImage), '-i', path.join(OUTPUT_DIR, sourceDir, clip));
      });
      inputArgs.push('-i', audioPath);

      let filterComplex = '';
      const scaledLabels = [];
      images.forEach((_, i) => {
        filterComplex += `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS-STARTPTS[v${i}];`;
        scaledLabels.push(`v${i}`);
      });

      if (transType !== 'none' && images.length > 1) {
        let prevLabel = scaledLabels[0];
        for (let i = 1; i < scaledLabels.length; i++) {
          const offset = i * durationPerImage - i * transDur;
          const outLabel = i < scaledLabels.length - 1 ? `xf${i}` : 'vout';
          filterComplex += `[${prevLabel}][${scaledLabels[i]}]xfade=transition=${transType}:duration=${transDur}:offset=${offset.toFixed(2)}[${outLabel}];`;
          prevLabel = outLabel;
        }
      } else {
        // 전환 없을 때 단순 concat
        filterComplex += scaledLabels.map(l => `[${l}]`).join('') + `concat=n=${scaledLabels.length}:v=1:a=0[vout];`;
      }

      filterComplex = filterComplex.slice(0, -1);

      ffmpegArgs = [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vout]', '-map', `${images.length}:a`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', outputPath
      ];
    } else if (transType !== 'none' && images.length > 1) {
      // === 이미지 모드 + 전환 효과 ===
      const inputArgs = [];
      images.forEach(img => {
        inputArgs.push('-loop', '1', '-t', String(durationPerImage), '-i', path.join(OUTPUT_DIR, sourceDir, img));
      });
      inputArgs.push('-i', audioPath);

      let filterComplex = '';
      const scaledLabels = [];
      const frames = Math.round(durationPerImage * 30);
      images.forEach((_, i) => {
        filterComplex += `[${i}:v]${getKenBurns(i, frames)}[v${i}];`;
        scaledLabels.push(`v${i}`);
      });

      let prevLabel = scaledLabels[0];
      for (let i = 1; i < scaledLabels.length; i++) {
        const offset = i * durationPerImage - i * transDur;
        const outLabel = i < scaledLabels.length - 1 ? `xf${i}` : 'vout';
        filterComplex += `[${prevLabel}][${scaledLabels[i]}]xfade=transition=${transType}:duration=${transDur}:offset=${offset.toFixed(2)}[${outLabel}];`;
        prevLabel = outLabel;
      }

      filterComplex = filterComplex.slice(0, -1);

      ffmpegArgs = [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vout]', '-map', `${images.length}:a`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', outputPath
      ];
    } else {
      // === 이미지 모드 + 전환 없음 (concat demuxer) ===
      const concatFile = path.join(OUTPUT_DIR, sourceDir, 'concat.txt');
      const concatContent = images
        .map(img => `file '${path.join(OUTPUT_DIR, sourceDir, img).replace(/\\/g, '/')}'\nduration ${durationPerImage}`)
        .join('\n');
      fs.writeFileSync(concatFile, concatContent + `\nfile '${path.join(OUTPUT_DIR, sourceDir, images[images.length - 1]).replace(/\\/g, '/')}'`);

      ffmpegArgs = [
        '-f', 'concat', '-safe', '0', '-i', concatFile,
        '-i', audioPath,
        '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.0008,1.25)':d=${Math.round(durationPerImage*30)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', outputPath
      ];
    }

    // === 단계 1: 메인 영상 렌더 (이미지/영상 + 오디오 + Ken Burns + 전환) ===
    console.log(`[Render] 1. 메인 렌더: ${useVideo?'영상 클립':'이미지'} ${images.length}개 × ${durationPerImage.toFixed(2)}초 = ${totalDuration.toFixed(2)}초`);
    let finalOutput = outputPath;
    const bgmPath = bgmFile ? path.join(OUTPUT_DIR, 'bgm', bgmFile) : null;
    const hasBgm = bgmPath && fs.existsSync(bgmPath);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ffmpegArgs, { timeout: 1200000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`FFmpeg 오류: ${error.message}\n${stderr}`));
        else resolve(stdout);
      });
    });

    // === 단계 2: BGM 믹싱 ===
    if (hasBgm) {
      console.log(`[Render] 2. BGM 믹싱: ${bgmFile}`);
      const bgmOutput = path.join(OUTPUT_DIR, 'video', `bgm_${outputFile}`);
      const vol = bgmVolume || 0.15;
      const bgmArgs = [
        '-i', outputPath,
        '-stream_loop', '-1', '-i', bgmPath,
        '-filter_complex', `[1:a]volume=${vol}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=3[aout]`,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', bgmOutput
      ];
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', bgmArgs, { timeout: 300000 }, (error, stdout, stderr) => {
          if (error) reject(new Error(`BGM 믹싱 오류: ${error.message}`));
          else resolve(stdout);
        });
      });
      try { fs.unlinkSync(outputPath); } catch(e) {}
      fs.renameSync(bgmOutput, outputPath);
    }

    // === 단계 3: 썸네일 인트로 prepend (3초, SRT 오프셋 위해 SRT보다 먼저) ===
    let srtOffset = 0;
    const THUMB_INTRO_SEC = 3;
    if (showThumb) {
      const thumbFiles = listFilesByMtime(path.join(OUTPUT_DIR, 'thumbnails'), f => f.endsWith('.png'));
      if (thumbFiles.length > 0) {
        const thumbPath = path.join(OUTPUT_DIR, 'thumbnails', thumbFiles[0]);
        console.log(`[Render] 3. 썸네일 인트로 prepend: ${thumbFiles[0]}`);
        const thumbVid = path.join(OUTPUT_DIR, 'video', `thumb_intro_${Date.now()}.mp4`);
        const thumbOutput = path.join(OUTPUT_DIR, 'video', `withthumb_${outputFile}`);
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', [
            '-loop', '1', '-t', String(THUMB_INTRO_SEC), '-i', thumbPath,
            '-f', 'lavfi', '-t', String(THUMB_INTRO_SEC), '-i', 'anullsrc=r=44100:cl=stereo',
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest',
            '-y', thumbVid
          ], { timeout: 60000 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`썸네일 인트로 생성 오류: ${error.message}\n${stderr}`));
            else resolve();
          });
        });
        // 메인 영상도 동일 코덱으로 재인코딩 후 concat (concat copy는 스트림 호환성 이슈 발생)
        const concatList = path.join(OUTPUT_DIR, 'video', 'thumb_concat.txt');
        fs.writeFileSync(concatList, `file '${thumbVid.replace(/\\/g, '/')}'\nfile '${outputPath.replace(/\\/g, '/')}'`);
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', [
            '-f', 'concat', '-safe', '0', '-i', concatList,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
            '-movflags', '+faststart', '-y', thumbOutput
          ], { timeout: 300000 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`썸네일 인트로 결합 오류: ${error.message}\n${stderr}`));
            else resolve();
          });
        });
        try { fs.unlinkSync(outputPath); fs.unlinkSync(thumbVid); fs.unlinkSync(concatList); } catch(e) {}
        fs.renameSync(thumbOutput, outputPath);
        srtOffset = THUMB_INTRO_SEC;  // 자막 타임라인을 3초 뒤로 밀어야 함
      }
    }

    // === 단계 4: SRT 자막 burn (오디오 길이 기반 즉석 생성 + 썸네일 오프셋 적용) ===
    if (burnSrt) {
      const scriptText = project.script || '';
      if (scriptText) {
        console.log(`[Render] 4. SRT 자동 생성 (오프셋 ${srtOffset}초) → burn`);
        const freshSrtContent = scriptToSrt(scriptText, audioDuration, srtOffset, project.ttsAlignment);
        const freshSrtFile = `render_${Date.now()}.srt`;
        const freshSrtPath = path.join(OUTPUT_DIR, 'srt', freshSrtFile);
        fs.writeFileSync(freshSrtPath, freshSrtContent, 'utf-8');

        const srtPathEscaped = freshSrtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        const srtOutput = path.join(OUTPUT_DIR, 'video', `srt_${outputFile}`);
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', [
            '-i', outputPath,
            '-vf', `subtitles='${srtPathEscaped}':force_style='FontName=Malgun Gothic,Fontname=Malgun Gothic,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=2,Shadow=1,MarginV=40,Bold=1,Italic=0,Alignment=2'`,
            '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
            '-movflags', '+faststart', '-y', srtOutput
          ], { timeout: 600000 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`자막 삽입 오류: ${error.message}\n${stderr}`));
            else resolve(stdout);
          });
        });
        try { fs.unlinkSync(outputPath); } catch(e) {}
        fs.renameSync(srtOutput, outputPath);
      }
    }

    // === 단계 5: 인트로 텍스트 오버레이 (첫 5초, 썸네일 있으면 3~8초) ===
    if (showIntro && project.topic) {
      const introStart = srtOffset;
      const introEnd = srtOffset + 5;
      console.log(`[Render] 5. 인트로 텍스트 오버레이 (${introStart}~${introEnd}초)`);
      const introOutput = path.join(OUTPUT_DIR, 'video', `intro_${outputFile}`);
      const introText = project.topic.replace(/'/g, "'\\''").replace(/:/g, '\\:');
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', outputPath,
          '-vf', `drawtext=text='${introText}':fontsize=56:fontcolor=white:borderw=3:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${introStart},${introEnd})':fontfile='C\\:/Windows/Fonts/malgunbd.ttf'`,
          '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
          '-movflags', '+faststart', '-y', introOutput
        ], { timeout: 300000 }, (error, stdout, stderr) => {
          if (error) reject(new Error(`인트로 텍스트 오류: ${error.message}\n${stderr}`));
          else resolve();
        });
      });
      try { fs.unlinkSync(outputPath); } catch(e) {}
      fs.renameSync(introOutput, outputPath);
    }

    project.videoFile = outputFile;
    const stats = fs.statSync(outputPath);

    let videoDuration = totalDuration;
    try {
      const dur = await new Promise((resolve, reject) => {
        execFile('ffmpeg', ['-i', outputPath], { timeout: 10000 }, (error, stdout, stderr) => {
          const match = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (match) resolve(parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]));
          else resolve(totalDuration);
        });
      });
      videoDuration = dur;
    } catch(e) {}

    res.json({
      success: true,
      videoUrl: `/output/video/${outputFile}`,
      filename: outputFile,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
      imageCount: images.length,
      audioFile,
      transition: transType,
      bgm: hasBgm ? bgmFile : null,
      duration: videoDuration
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// BGM 업로드
app.post('/api/bgm/upload', express.raw({ type: 'audio/*', limit: '50mb' }), (req, res) => {
  try {
    const filename = `bgm_${Date.now()}.mp3`;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'bgm', filename), req.body);
    res.json({ success: true, filename, url: `/output/bgm/${filename}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bgm/list', (req, res) => {
  const bgmDir = path.join(OUTPUT_DIR, 'bgm');
  const files = fs.readdirSync(bgmDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')).map(f => ({
    name: f, url: `/output/bgm/${f}`, size: `${(fs.statSync(path.join(bgmDir, f)).size / 1024).toFixed(0)}KB`
  }));
  res.json({ success: true, files });
});

// 프로젝트 목록 관리
app.get('/api/projects/list', (req, res) => {
  const list = Object.values(projects).map(p => ({
    id: p.id, topic: p.topic, createdAt: p.createdAt,
    hasScript: !!p.script, hasVideo: !!p.videoFile,
    imageCount: p.imageFiles?.length || 0
  }));
  res.json({ success: true, projects: list });
});

app.delete('/api/project/:id', (req, res) => {
  delete projects[req.params.id];
  res.json({ success: true });
});

// ========================
// 7. 제목/설명/태그 생성 (Claude)
// ========================
app.post('/api/meta/generate', async (req, res) => {
  try {
    const { projectId, topic, script, languages } = req.body;
    const project = getProject(projectId);

    const langs = languages || ['ko'];
    const langNames = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어' };
    const langList = langs.map(l => langNames[l] || l).join(', ');

    const prompt = `유튜브 영상 메타데이터를 생성해주세요.

주제: ${topic || project.topic}
${(script || project.script) ? `대본 요약:\n${(script || project.script).substring(0, 1500)}` : ''}

다음 JSON 형식으로 작성:
{
  "titles": [
    { "lang": "ko", "options": ["제목1", "제목2", "제목3"] }
    ${langs.includes('en') ? ', { "lang": "en", "options": ["Title1", "Title2", "Title3"] }' : ''}
    ${langs.includes('ja') ? ', { "lang": "ja", "options": ["タイトル1", "タイトル2", "タイトル3"] }' : ''}
  ],
  "description": {
    "ko": "한국어 설명 (타임스탬프 포함, 300자 이상)"
    ${langs.includes('en') ? ', "en": "English description"' : ''}
    ${langs.includes('ja') ? ', "ja": "日本語の説明"' : ''}
  },
  "tags": ["태그1", "태그2", "...최소 15개"],
  "pinnedComment": "고정 댓글 (시청자 참여 유도)",
  "category": "YouTube 카테고리 (Education, Entertainment, etc.)"
}

규칙:
- 제목: 호기심 극대화, 클릭률 최적화, 50자 이내
- 설명: 타임스탬프(00:00 형식) 포함, 검색 최적화
- 태그: 관련 키워드 15개 이상
- 고정 댓글: 시청자 공감 + 댓글 참여 유도

JSON만 반환하세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const meta = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    project.meta = meta;

    res.json({ success: true, meta });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 8. 썸네일 생성 (ChatGPT Images 2.0)
// ========================
app.post('/api/thumbnail/generate', async (req, res) => {
  try {
    const { projectId, topic, style, text } = req.body;

    let hookText = text;
    if (!hookText && topic) {
      const hookMsg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: `유튜브 썸네일에 들어갈 강렬한 관심 유발 문구를 만들어주세요.
주제: "${topic}"
규칙:
- 한국어
- 메인 문구: 8자 이내 (충격/호기심/긴박감 자극)
- 서브 문구: 15자 이내 (영상 내용을 어필하는 보조 설명)
- 예: "충격 진실" + "역사가 감춘 7가지 비밀"
JSON으로 출력: {"main":"메인문구","sub":"서브문구"}` }]
      });
      try {
        const parsed = JSON.parse(hookMsg.content[0].text.trim().match(/\{[\s\S]*\}/)?.[0] || '{}');
        hookText = parsed.main || hookMsg.content[0].text.trim().replace(/["""]/g, '');
        var subText = parsed.sub || '';
      } catch(e) {
        hookText = hookMsg.content[0].text.trim().replace(/["""]/g, '');
        var subText = '';
      }
    }

    const styleGuide = {
      dramatic: 'dramatic lighting, high contrast, dark background, cinematic, powerful imagery, depth of field',
      clean: 'clean minimal design, modern, professional, white space, sharp typography, gradient background',
      clickbait: 'vibrant colors, shocked expression, red highlights, bold arrows, attention-grabbing, neon accents',
      cinematic: 'cinematic wide shot, film-like, teal and orange grading, atmospheric, lens flare'
    };

    // gpt-image-1이 텍스트를 그리지 않도록 명시 — drawtext로만 텍스트 오버레이
    const thumbPrompt = `YouTube video thumbnail in exact 16:9 aspect ratio (1280x720), ${styleGuide[style] || styleGuide.dramatic}, topic: "${topic}", background image related to the topic with dramatic composition, professional YouTube thumbnail design, high impact visual, cinematic composition with empty space in the upper-left and lower-center area for text overlay. IMPORTANT: NO TEXT, NO LETTERS, NO WORDS, NO TYPOGRAPHY, NO CAPTIONS, NO WRITTEN CONTENT of any kind in the image — pure visual scene only.`;

    const image = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: thumbPrompt,
      size: '1536x1024',
      quality: 'high',
      n: 1
    });

    const b64 = image.data[0].b64_json;
    const buffer = Buffer.from(b64, 'base64');
    const rawFile = `thumbnail_raw_${Date.now()}.png`;
    const rawPath = path.join(OUTPUT_DIR, 'thumbnails', rawFile);
    fs.writeFileSync(rawPath, buffer);

    // 1단계: 16:9 크롭
    const croppedFile = `thumbnail_cropped_${Date.now()}.png`;
    const croppedPath = path.join(OUTPUT_DIR, 'thumbnails', croppedFile);
    await new Promise((resolve) => {
      execFile('ffmpeg', [
        '-i', rawPath,
        '-vf', 'crop=ih*16/9:ih,scale=1280:720',
        '-y', croppedPath
      ], { timeout: 30000 }, (error) => {
        if (error) { fs.copyFileSync(rawPath, croppedPath); }
        resolve();
      });
    });

    // 2단계: FFmpeg drawtext로 한글 텍스트 오버레이 — 화면 안에 들어가도록 동적 사이즈/줄바꿈
    const filename = `thumbnail_${Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, 'thumbnails', filename);
    const fontPath = 'C\\:/Windows/Fonts/malgunbd.ttf';

    // 한글 1글자 = 약 fontSize px 폭 차지 (고딕 굵게)
    // 가용 폭 1280 - 좌우 여백 80 × 2 = 1120
    const SAFE_W = 1120;

    function wrapLines(text, fontSize) {
      const maxChars = Math.floor(SAFE_W / (fontSize * 0.95));
      const chars = [...text];
      const lines = [];
      let cur = '';
      for (const ch of chars) {
        if ((cur + ch).length > maxChars && cur.length > 0) {
          // 공백/쉼표에서 자르기 우선
          const cutIdx = Math.max(cur.lastIndexOf(' '), cur.lastIndexOf(','), cur.lastIndexOf('，'));
          if (cutIdx > maxChars * 0.5) {
            lines.push(cur.substring(0, cutIdx).trim());
            cur = cur.substring(cutIdx).trim() + ch;
          } else {
            lines.push(cur);
            cur = ch;
          }
        } else {
          cur += ch;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    }

    function pickFontSize(text, baseSize, minSize) {
      const len = [...text].length;
      // 글자 수가 많으면 폰트 줄임
      let size = baseSize;
      while (size > minSize) {
        const maxCharsPerLine = Math.floor(SAFE_W / (size * 0.95));
        if (len <= maxCharsPerLine * 2) break; // 2줄 이내 가능
        size -= 4;
      }
      return size;
    }

    const mainText = (hookText || '').trim();
    const subTxt = (subText || '').trim();

    // === 파격적 디자인 — 최대 임팩트 ===
    // 메인 폰트 110pt까지 확대 (더 큰 임팩트)
    const mainFontSize = pickFontSize(mainText, 110, 56);
    const mainLines = wrapLines(mainText, mainFontSize);

    const subFontSize = subTxt ? pickFontSize(subTxt, 50, 32) : 0;
    const subLines = subTxt ? wrapLines(subTxt, subFontSize) : [];

    const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/%/g, '\\%');

    // 텍스트 블록 높이 (라인 간격 1.2)
    const mainLineH = Math.round(mainFontSize * 1.2);
    const subLineH = Math.round(subFontSize * 1.2);
    const mainTotalH = mainLines.length * mainLineH;
    const subTotalH = subLines.length * subLineH;
    const gap = subTxt ? 60 : 0;
    const totalH = mainTotalH + gap + subTotalH;

    // 세로 중앙 정렬
    const startY = Math.round((720 - totalH) / 2);

    // === 파격적 다층 효과 ===
    // 1. 어두운 비네트 (반투명 검정 그라데이션) — 텍스트 가독성 + 영화관 느낌
    // 2. 빨간 사선 액센트 바 (drawbox로 좌측 상단)
    // 3. 노란 가로 액센트 바 (메인 텍스트 위/아래)
    // 4. 메인 텍스트: 5겹 그림자 (붉은 외광 → 검정 그림자 → 노란 메인)
    // 5. 서브 텍스트: 노란 테두리 빨간 박스 (이중 박스)
    const filters = [];

    // 비네트 효과 (좌우 어두운 페이드) — 텍스트 영역 강조
    filters.push(`drawbox=x=0:y=0:w=1280:h=720:color=black@0.35:t=fill`);

    // 좌측 상단 빨간 액센트 바 (사선 느낌)
    filters.push(`drawbox=x=0:y=0:w=180:h=8:color=#FF1744:t=fill`);
    filters.push(`drawbox=x=0:y=8:w=120:h=6:color=#FFEB3B:t=fill`);
    // 우측 하단 미러
    filters.push(`drawbox=x=1100:y=706:w=180:h=8:color=#FF1744:t=fill`);
    filters.push(`drawbox=x=1160:y=700:w=120:h=6:color=#FFEB3B:t=fill`);

    // 메인 텍스트 위쪽 노란 가로 액센트 바 (5px 두께)
    if (mainLines.length > 0) {
      const barY = startY - 18;
      filters.push(`drawbox=x=(iw-280)/2:y=${barY}:w=280:h=6:color=#FFEB3B:t=fill`);
      filters.push(`drawbox=x=(iw-280)/2-3:y=${barY-3}:w=6:h=12:color=#FF1744:t=fill`);
      filters.push(`drawbox=x=(iw-280)/2+277:y=${barY-3}:w=6:h=12:color=#FF1744:t=fill`);
      // (이미 drawbox 표현식 수정됨)
    }

    // 메인 텍스트 — 5겹 임팩트
    mainLines.forEach((line, i) => {
      const y = startY + i * mainLineH;
      const esc = escapeText(line);
      // 1) 외광 효과 — 빨간 그림자 (12px 오프셋, 큰 블러 느낌)
      filters.push(`drawtext=text='${esc}':fontfile='${fontPath}':fontsize=${mainFontSize}:fontcolor=#FF1744@0.5:x=(w-text_w)/2+12:y=${y}+12`);
      // 2) 빨간 그림자 (8px)
      filters.push(`drawtext=text='${esc}':fontfile='${fontPath}':fontsize=${mainFontSize}:fontcolor=#FF1744@0.85:x=(w-text_w)/2+8:y=${y}+8`);
      // 3) 검정 그림자 (4px) — 깊이감
      filters.push(`drawtext=text='${esc}':fontfile='${fontPath}':fontsize=${mainFontSize}:fontcolor=black:x=(w-text_w)/2+4:y=${y}+4`);
      // 4) 메인 — 노란색 + 두꺼운 검정 외곽선 (12px)
      filters.push(`drawtext=text='${esc}':fontfile='${fontPath}':fontsize=${mainFontSize}:fontcolor=#FFEB3B:borderw=12:bordercolor=black:x=(w-text_w)/2:y=${y}`);
      // 5) 하이라이트 — 옅은 흰색 위 (위쪽 1/3에 흰빛)
      filters.push(`drawtext=text='${esc}':fontfile='${fontPath}':fontsize=${mainFontSize}:fontcolor=white@0.0:x=(w-text_w)/2:y=${y}`);
    });

    // 메인 텍스트 아래 노란 가로 액센트 바
    if (mainLines.length > 0 && subLines.length === 0) {
      const barY = startY + mainTotalH + 14;
      filters.push(`drawbox=x=(iw-280)/2:y=${barY}:w=280:h=6:color=#FFEB3B:t=fill`);
    }

    // 서브 텍스트 — 이중 박스 (노란 테두리 + 빨간 본체) + 큰 그림자
    subLines.forEach((line, i) => {
      const y = startY + mainTotalH + gap + i * subLineH;
      const esc = escapeText(line);
      // 외곽 노란 박스 효과 (text_w 추정 위해 노란 박스 먼저 그리고 그 위에 빨간 박스 + 텍스트)
      filters.push(`drawtext=text='${esc}':fontfile='${fontPath}':fontsize=${subFontSize}:fontcolor=#FFEB3B@0:box=1:boxcolor=#FFEB3B@1:boxborderw=22:x=(w-text_w)/2:y=${y}`);
      // 그 위에 빨간 박스 + 흰 텍스트
      filters.push(`drawtext=text='${esc}':fontfile='${fontPath}':fontsize=${subFontSize}:fontcolor=white:borderw=4:bordercolor=black:shadowcolor=black@0.9:shadowx=5:shadowy=5:box=1:boxcolor=#D50000@1:boxborderw=15:x=(w-text_w)/2:y=${y}`);
    });

    const drawFilters = filters.join(',');

    await new Promise((resolve) => {
      execFile('ffmpeg', [
        '-i', croppedPath,
        '-vf', drawFilters,
        '-y', filepath
      ], { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) { console.error('[Thumbnail drawtext]', stderr); fs.copyFileSync(croppedPath, filepath); }
        resolve();
      });
    });
    try { fs.unlinkSync(rawPath); } catch(e) {}
    try { fs.unlinkSync(croppedPath); } catch(e) {}

    res.json({
      success: true,
      imageUrl: `/output/thumbnails/${filename}`,
      filename,
      hookText,
      subText: subText || ''
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 9. 쇼츠 대본 생성 (Claude)
// ========================
app.post('/api/shorts/generate', async (req, res) => {
  try {
    const { projectId, script, count, length } = req.body;
    const project = getProject(projectId);

    const prompt = `다음 유튜브 롱폼 대본에서 핵심 내용을 추출하여, ${count || 3}개의 YouTube Shorts(세로형 9:16) 대본을 작성해주세요.

원본 대본:
${(script || project.script || '').substring(0, 3000)}

규칙:
- 각 쇼츠: ${length || 60}초 분량
- 강력한 후킹으로 시작 (첫 3초가 핵심)
- 세로형 9:16 비율에 맞는 비주얼 가이드 포함
- 마지막에 풀영상 유도 CTA
- 자막 필수 (핵심 단어 강조)

JSON 배열 형식:
[
  {
    "number": 1,
    "title": "쇼츠 제목",
    "hook": "첫 3초 후킹 문장",
    "script": "전체 대본 (타임스탬프 포함)",
    "visualGuide": "비주얼 연출 가이드",
    "duration": ${length || 60}
  }
]

JSON만 반환하세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const shorts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    res.json({ success: true, shorts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 10. 인트로 생성 (Claude)
// ========================
app.post('/api/intro/generate', async (req, res) => {
  try {
    const { projectId, topic, type, length, script } = req.body;
    const project = getProject(projectId);

    const prompt = `유튜브 영상 인트로(오프닝) 대본을 작성해주세요.

주제: ${topic || project.topic}
인트로 유형: ${type || '질문형'}
길이: ${length || 30}초
${(script || project.script) ? `대본 참고:\n${(script || project.script).substring(0, 1000)}` : ''}

작성 규칙:
1. 첫 5초 안에 시청자를 사로잡을 강력한 후킹
2. 나레이션 톤/감정 지문 표기 (괄호 안에)
3. 비주얼 연출 가이드
4. BGM 분위기 제안
5. 초 단위 타임스탬프

전문적이고 몰입감 있는 인트로를 작성해주세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    res.json({ success: true, intro: message.content[0].text });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// YouTube OAuth2 + Upload
// ========================
app.get('/api/youtube/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube'
    ],
    prompt: 'consent'
  });
  res.json({ success: true, authUrl });
});

app.get('/api/youtube/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    youtubeTokens = tokens;
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    res.send('<html><body><h2>YouTube 연동 완료!</h2><p>이 창을 닫고 대시보드로 돌아가세요.</p><script>window.close()</script></body></html>');
  } catch (error) {
    res.status(500).send(`인증 오류: ${error.message}`);
  }
});

app.get('/api/youtube/status', (req, res) => {
  res.json({
    authenticated: !!youtubeTokens,
    hasClientId: !!process.env.YOUTUBE_CLIENT_ID
  });
});

app.post('/api/youtube/upload', async (req, res) => {
  try {
    if (!youtubeTokens) throw new Error('YouTube 인증이 필요합니다. 먼저 OAuth 인증을 완료하세요.');

    const { projectId, title, description, tags, categoryId, privacyStatus, thumbnailFile } = req.body;
    const project = getProject(projectId);

    const videoFiles = fs.readdirSync(path.join(OUTPUT_DIR, 'video'))
      .filter(f => f.endsWith('.mp4'))
      .sort()
      .reverse();

    if (videoFiles.length === 0) throw new Error('업로드할 영상 파일이 없습니다.');

    const videoPath = path.join(OUTPUT_DIR, 'video', project.videoFile || videoFiles[0]);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const uploadRes = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: title || project.meta?.titles?.[0]?.options?.[0] || project.topic,
          description: description || project.meta?.description?.ko || '',
          tags: tags || project.meta?.tags || [],
          categoryId: categoryId || '22',
          defaultLanguage: 'ko'
        },
        status: {
          privacyStatus: privacyStatus || 'private',
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    });

    const videoId = uploadRes.data.id;

    if (thumbnailFile) {
      const thumbPath = path.join(OUTPUT_DIR, 'thumbnails', thumbnailFile);
      if (fs.existsSync(thumbPath)) {
        await youtube.thumbnails.set({
          videoId,
          media: { body: fs.createReadStream(thumbPath) }
        });
      }
    }

    res.json({
      success: true,
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      studioUrl: `https://studio.youtube.com/video/${videoId}/edit`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================
// 프로젝트 관리
// ========================
app.get('/api/project/:id', (req, res) => {
  const project = getProject(req.params.id);
  res.json({ success: true, project });
});

app.get('/api/files/list', (req, res) => {
  const result = {};
  ['images', 'audio', 'video', 'thumbnails', 'bgm', 'srt'].forEach(dir => {
    const dirPath = path.join(OUTPUT_DIR, dir);
    result[dir] = fs.readdirSync(dirPath).filter(f => !f.endsWith('.txt')).map(f => ({
      name: f,
      url: `/output/${dir}/${f}`,
      size: `${(fs.statSync(path.join(dirPath, f)).size / 1024).toFixed(0)}KB`
    }));
  });
  res.json({ success: true, files: result });
});

// ========================
// FFmpeg Check
// ========================
app.get('/api/system/ffmpeg', (req, res) => {
  execFile('ffmpeg', ['-version'], { timeout: 5000 }, (error, stdout) => {
    if (error) {
      res.json({ success: true, installed: false, error: error.message });
    } else {
      const version = stdout.split('\n')[0] || 'unknown';
      res.json({ success: true, installed: true, version });
    }
  });
});

// ========================
// Audio Duration (via ffprobe)
// ========================
app.get('/api/audio/duration/:filename', (req, res) => {
  const filepath = path.join(OUTPUT_DIR, 'audio', req.params.filename);
  if (!fs.existsSync(filepath)) return res.json({ success: false, error: 'File not found' });

  execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filepath],
    { timeout: 10000 }, (error, stdout) => {
      if (error) return res.json({ success: true, duration: 0 });
      try {
        const info = JSON.parse(stdout);
        res.json({ success: true, duration: parseFloat(info.format.duration || 0) });
      } catch(e) { res.json({ success: true, duration: 0 }); }
    });
});

// ========================
// File Cleanup
// ========================
app.post('/api/files/clean', (req, res) => {
  let deleted = 0;
  ['images', 'audio', 'video', 'thumbnails', 'bgm', 'srt'].forEach(dir => {
    const dirPath = path.join(OUTPUT_DIR, dir);
    fs.readdirSync(dirPath).forEach(f => {
      if (f === '.gitkeep' || f === 'concat.txt') return;
      fs.unlinkSync(path.join(dirPath, f));
      deleted++;
    });
  });
  res.json({ success: true, deleted });
});

// ========================
// Start
// ========================
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  YouTube 롱폼 에이전트 서버`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`${'='.repeat(50)}`);
  console.log(`\n  API 상태:`);
  console.log(`  - Claude API: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}`);
  console.log(`  - GPT Image:  ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`  - ElevenLabs: ${process.env.ELEVENLABS_API_KEY ? '✅' : '❌'}`);
  console.log(`  - YouTube:    ${process.env.YOUTUBE_CLIENT_ID ? '✅' : '❌'}`);
  console.log(`\n  출력 폴더: ${OUTPUT_DIR}\n`);
});
