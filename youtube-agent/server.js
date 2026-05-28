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

['images', 'audio', 'video', 'thumbnails', 'bgm', 'srt'].forEach(dir => {
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
    const { category, target, keyword } = req.body;

    const prompt = `당신은 100만 구독자를 보유한 전문 유튜브 채널 기획자입니다.

다음 조건에 맞는 유튜브 롱폼 영상 주제 6개를 추천해주세요:
- 카테고리: ${category || '자유'}
- 타겟 시청자: ${target || '전 연령'}
${keyword ? `- 관련 키워드: ${keyword}` : ''}

각 주제마다 다음 JSON 형식으로 작성해주세요:
[
  {
    "title": "영상 제목",
    "description": "2줄 설명",
    "estimatedViews": "예상 조회수 (예: 50만+)",
    "difficulty": "하/중/상",
    "category": "${category || 'general'}",
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
3. 각 장면을 [장면 1: 제목], [장면 2: 제목] 형식으로 구분
4. 나레이션에 감정/톤 지문을 괄호 안에 표기 (예: (차분하게), (긴장감 있게))
5. CTA: 마지막에 자연스러운 좋아요/구독 요청
6. 각 장면마다 "▶ 이미지:" 태그로 해당 장면의 비주얼을 간략히 묘사

${wordCount || 3000}자 이상의 완성된 대본을 작성해주세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
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
// 4. 이미지 생성 (DALL-E 3)
// ========================
app.post('/api/images/generate', async (req, res) => {
  try {
    const { projectId, prompt, style, index, ratio } = req.body;

    const sizeMap = {
      '16:9': '1792x1024',
      '9:16': '1024x1792',
      '1:1': '1024x1024'
    };

    const stylePrefix = {
      'european-animation': 'European animation style, Ghibli-inspired, soft lighting, painterly textures,',
      'realistic': 'photorealistic, hyper-detailed, 8K resolution, cinematic lighting,',
      'watercolor': 'watercolor painting style, soft edges, flowing colors,',
      'cinematic': 'cinematic concept art, dramatic lighting, film grain,',
      'oil-painting': 'classical oil painting style, rich colors, Renaissance-inspired,'
    };

    const fullPrompt = `${stylePrefix[style] || ''} ${prompt}. High quality, detailed, professional.`;

    const image = await openai.images.generate({
      model: 'dall-e-3',
      prompt: fullPrompt,
      size: sizeMap[ratio] || '1792x1024',
      quality: 'hd',
      n: 1
    });

    const imageUrl = image.data[0].url;
    const revisedPrompt = image.data[0].revised_prompt;

    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `scene_${index || Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, 'images', filename);
    fs.writeFileSync(filepath, buffer);

    const project = getProject(projectId);
    project.imageFiles.push({ index, filename, filepath, prompt: fullPrompt });

    res.json({
      success: true,
      imageUrl: `/output/images/${filename}`,
      revisedPrompt,
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

    const prompt = `다음 유튜브 영상 대본을 읽고, ${count || 8}개 장면에 대한 이미지 생성 프롬프트를 영어로 작성해주세요.

대본:
${(script || project.script || '').substring(0, 3000)}

각 프롬프트는 다음 JSON 배열 형식으로 작성:
[
  {
    "scene": 1,
    "name": "장면 이름 (한국어)",
    "prompt": "영어 이미지 생성 프롬프트 (상세하게, 50단어 이상)"
  }
]

스타일: ${style || 'european-animation'}
모든 이미지가 일관된 스타일을 유지하도록 프롬프트를 작성하세요.
JSON 배열만 반환하세요.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
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

    const cleanScript = (script || project.script || '')
      .replace(/\[장면[^\]]*\]/g, '')
      .replace(/[━═─]/g, '')
      .replace(/[🎙️🎬📌🔹▶✅☐■●•]/g, '')
      .replace(/\(.*?\)/g, '')
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

    if (chunks.length === 1) {
      const audioBuffer = await generateTTSChunk(chunks[0]);
      const filename = `full_narration_${timestamp}.mp3`;
      fs.writeFileSync(path.join(OUTPUT_DIR, 'audio', filename), audioBuffer);
      project.audioFiles = [{ index: 0, filename, filepath: path.join(OUTPUT_DIR, 'audio', filename), full: true }];
      return res.json({ success: true, audioUrl: `/output/audio/${filename}`, filename, charCount: cleanScript.length, chunks: 1 });
    }

    const chunkFiles = [];
    for (let i = 0; i < chunks.length; i++) {
      const buf = await generateTTSChunk(chunks[i]);
      const chunkFile = `chunk_${timestamp}_${i}.mp3`;
      fs.writeFileSync(path.join(OUTPUT_DIR, 'audio', chunkFile), buf);
      chunkFiles.push(chunkFile);
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    const concatList = chunkFiles.map(f => `file '${path.join(OUTPUT_DIR, 'audio', f).replace(/\\/g, '/')}'`).join('\n');
    const concatFile = path.join(OUTPUT_DIR, 'audio', `concat_${timestamp}.txt`);
    fs.writeFileSync(concatFile, concatList);

    const filename = `full_narration_${timestamp}.mp3`;
    const outputPath = path.join(OUTPUT_DIR, 'audio', filename);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', '-y', outputPath],
        { timeout: 60000 }, (error) => { if (error) reject(error); else resolve(); });
    });

    chunkFiles.forEach(f => { try { fs.unlinkSync(path.join(OUTPUT_DIR, 'audio', f)); } catch(e) {} });
    try { fs.unlinkSync(concatFile); } catch(e) {}

    project.audioFiles = [{ index: 0, filename, filepath: outputPath, full: true }];

    res.json({ success: true, audioUrl: `/output/audio/${filename}`, filename, charCount: cleanScript.length, chunks: chunks.length });
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

    const sceneRegex = /\[장면\s*(\d+)[^\]]*\]([\s\S]*?)(?=\[장면|\s*$)/g;
    const scenes = [];
    let match;
    while ((match = sceneRegex.exec(text)) !== null) {
      const content = match[2].replace(/[━═─▶■●•🎙️🎬📌🔹✅☐]/g, '').replace(/\(.*?\)/g, '').replace(/\n{2,}/g, '\n').trim();
      if (content) scenes.push(content);
    }

    if (scenes.length === 0) {
      const paragraphs = text.replace(/\[.*?\]/g, '').replace(/[━═─▶■●•🎙️🎬📌🔹✅☐]/g, '').replace(/\(.*?\)/g, '').split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 10);
      scenes.push(...paragraphs);
    }

    const totalDur = duration || 120;
    const totalChars = scenes.reduce((a, s) => a + s.length, 0);
    let currentTime = 0;
    let srtContent = '';

    scenes.forEach((scene, idx) => {
      const sceneDur = (scene.length / totalChars) * totalDur;
      const sentences = scene.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [scene];
      const sentTotalChars = sentences.reduce((a, s) => a + s.length, 0);

      sentences.forEach((sent, si) => {
        const sentText = sent.trim();
        if (!sentText || sentText.length < 3) return;
        const sentDur = Math.max(1, (sentText.length / sentTotalChars) * sceneDur);
        const startTime = currentTime;
        const endTime = currentTime + sentDur;

        const formatTime = (sec) => {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          const s = Math.floor(sec % 60);
          const ms = Math.round((sec % 1) * 1000);
          return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
        };

        const subIdx = srtContent.split('\n\n').filter(Boolean).length + 1;
        srtContent += `${subIdx}\n${formatTime(startTime)} --> ${formatTime(endTime)}\n${sentText}\n\n`;
        currentTime = endTime;
      });
    });

    const filename = `subtitles_${Date.now()}.srt`;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'srt', filename), srtContent, 'utf-8');

    res.json({
      success: true,
      srtUrl: `/output/srt/${filename}`,
      filename,
      subtitleCount: srtContent.split('\n\n').filter(Boolean).length,
      preview: srtContent.substring(0, 500)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/output/srt', express.static(path.join(OUTPUT_DIR, 'srt')));
app.use('/output/bgm', express.static(path.join(OUTPUT_DIR, 'bgm')));

// ========================
// 6. 영상 렌더링 (FFmpeg)
// ========================
app.post('/api/render/video', async (req, res) => {
  try {
    const { projectId, duration, bgmFile, bgmVolume, transition, transitionDuration } = req.body;
    const project = getProject(projectId);

    const images = fs.readdirSync(path.join(OUTPUT_DIR, 'images'))
      .filter(f => f.startsWith('scene_') && f.endsWith('.png'))
      .sort();
    const audioFiles = fs.readdirSync(path.join(OUTPUT_DIR, 'audio'))
      .filter(f => f.endsWith('.mp3'))
      .sort();

    if (images.length === 0) throw new Error('이미지 파일이 없습니다. 먼저 이미지를 생성하세요.');
    if (audioFiles.length === 0) throw new Error('오디오 파일이 없습니다. 먼저 TTS를 생성하세요.');

    const audioFile = audioFiles.find(f => f.startsWith('full_')) || audioFiles[0];
    const audioPath = path.join(OUTPUT_DIR, 'audio', audioFile);

    const totalDuration = duration || 120;
    const durationPerImage = totalDuration / images.length;
    const transDur = Math.min(parseFloat(transitionDuration) || 0.8, durationPerImage * 0.4);
    const transType = transition || 'none';

    const outputFile = `video_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, 'video', outputFile);

    let ffmpegArgs;

    if (transType !== 'none' && images.length > 1) {
      const inputArgs = [];
      images.forEach(img => {
        inputArgs.push('-loop', '1', '-t', String(durationPerImage), '-i', path.join(OUTPUT_DIR, 'images', img));
      });
      inputArgs.push('-i', audioPath);

      let filterComplex = '';
      const scaledLabels = [];
      images.forEach((_, i) => {
        filterComplex += `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='min(zoom+0.0005,1.15)':d=${Math.round(durationPerImage*30)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30[v${i}];`;
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
      const concatFile = path.join(OUTPUT_DIR, 'images', 'concat.txt');
      const concatContent = images
        .map(img => `file '${path.join(OUTPUT_DIR, 'images', img).replace(/\\/g, '/')}'\nduration ${durationPerImage}`)
        .join('\n');
      fs.writeFileSync(concatFile, concatContent + `\nfile '${path.join(OUTPUT_DIR, 'images', images[images.length - 1]).replace(/\\/g, '/')}'`);

      ffmpegArgs = [
        '-f', 'concat', '-safe', '0', '-i', concatFile,
        '-i', audioPath,
        '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z=\'min(zoom+0.0005,1.15)\':d=1:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1920x1080:fps=30',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
        '-y', outputPath
      ];
    }

    // BGM mixing as a second pass if requested
    let finalOutput = outputPath;
    const bgmPath = bgmFile ? path.join(OUTPUT_DIR, 'bgm', bgmFile) : null;
    const hasBgm = bgmPath && fs.existsSync(bgmPath);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ffmpegArgs, { timeout: 1200000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`FFmpeg 오류: ${error.message}\n${stderr}`));
        else resolve(stdout);
      });
    });

    if (hasBgm) {
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

    project.videoFile = outputFile;
    const stats = fs.statSync(outputPath);

    res.json({
      success: true,
      videoUrl: `/output/video/${outputFile}`,
      filename: outputFile,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
      imageCount: images.length,
      audioFile,
      transition: transType,
      bgm: hasBgm ? bgmFile : null
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
// 8. 썸네일 생성 (DALL-E 3)
// ========================
app.post('/api/thumbnail/generate', async (req, res) => {
  try {
    const { projectId, topic, style, text } = req.body;

    const styleGuide = {
      dramatic: 'dramatic lighting, high contrast, dark background, cinematic, powerful imagery',
      clean: 'clean minimal design, modern, professional, white space, sharp typography',
      clickbait: 'vibrant colors, shocked expression, red highlights, bold arrows, attention-grabbing',
      cinematic: 'cinematic wide shot, film-like, teal and orange grading, atmospheric'
    };

    const thumbPrompt = `YouTube video thumbnail, ${styleGuide[style] || styleGuide.dramatic}, topic: "${topic}", ${text ? `with text overlay "${text}"` : 'visually striking without text'}, 1280x720 resolution, eye-catching, professional quality, 16:9 aspect ratio`;

    const image = await openai.images.generate({
      model: 'dall-e-3',
      prompt: thumbPrompt,
      size: '1792x1024',
      quality: 'hd',
      n: 1
    });

    const imageUrl = image.data[0].url;
    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `thumbnail_${Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, 'thumbnails', filename);
    fs.writeFileSync(filepath, buffer);

    res.json({
      success: true,
      imageUrl: `/output/thumbnails/${filename}`,
      filename,
      revisedPrompt: image.data[0].revised_prompt
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
  console.log(`  - DALL-E API: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`  - ElevenLabs: ${process.env.ELEVENLABS_API_KEY ? '✅' : '❌'}`);
  console.log(`  - YouTube:    ${process.env.YOUTUBE_CLIENT_ID ? '✅' : '❌'}`);
  console.log(`\n  출력 폴더: ${OUTPUT_DIR}\n`);
});
