require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const app = express();
const PORT = 3847;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const HF_API_ID = process.env.HIGGSFIELD_API_ID;
const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Poll Higgsfield job until completed
async function pollHfJob(jobSetId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const result = await hfApi(`/v1/job-sets/${jobSetId}`, 'GET');
      const job = result?.jobs?.[0];
      if (!job) continue;
      if (job.status === 'completed') return job.results?.raw?.url || job.results?.min?.url || '';
      if (job.status === 'failed' || job.status === 'nsfw') return '';
      console.log(`[HF] Job ${jobSetId.substring(0,8)} status: ${job.status}`);
    } catch {}
  }
  return '';
}

// Higgsfield Platform API (platform.higgsfield.ai)
async function hfApi(endpoint, method, body) {
  if (!HF_API_ID || !HF_SECRET) throw new Error('Higgsfield API credentials not set');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`https://platform.higgsfield.ai${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'hf-api-key': HF_API_ID,
        'hf-secret': HF_SECRET
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    const data = await res.json();
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Claude API call for prompt generation
async function claudeGenerate(systemPrompt, userPrompt) {
  if (!CLAUDE_KEY) return userPrompt;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      }),
      signal: controller.signal
    });
    const data = await res.json();
    return data.content?.[0]?.text || userPrompt;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return userPrompt;
  } finally {
    clearTimeout(timeout);
  }
}

// Generate navigation menu via Claude
app.post('/api/generate-menu', async (req, res) => {
  try {
    const { topic, siteType } = req.body;
    const result = await claudeGenerate(
      `You generate Korean navigation menu items for websites. Output ONLY a valid JSON array. Each item has "name" (Korean menu label, 2-4 chars) and "link" (anchor hash like #about). Generate 4-6 items appropriate for the website type and topic. No explanation, no markdown, just the JSON array.`,
      `Website type: ${siteType}\nTopic: ${topic}\n\nGenerate menu items as JSON array.`
    );
    let items = [];
    const match = result.match(/\[[\s\S]*\]/);
    if (match) items = JSON.parse(match[0]);
    res.json({ success: true, items });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Generate optimized image prompt via Claude
app.post('/api/generate-image-prompt', async (req, res) => {
  try {
    const { topic, siteType, colorTheme, description } = req.body;
    const prompt = await claudeGenerate(
      `You are an expert AI image prompt engineer. Generate a single, detailed image generation prompt for creating a hero background image for a website. Output ONLY the prompt text, no explanations. The prompt should be in English, highly detailed, cinematic, and suitable for GPT Image 2.0. Never include text or watermarks in the image.`,
      `Website type: ${siteType}
Topic/Theme: ${topic}
Color mood: ${colorTheme}
Additional context: ${description || 'none'}

Generate a stunning, photorealistic image prompt for this website's hero section background.`
    );
    res.json({ success: true, prompt });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Generate optimized video prompt via Claude
app.post('/api/generate-video-prompt', async (req, res) => {
  try {
    const { topic, siteType, imagePrompt } = req.body;
    const prompt = await claudeGenerate(
      `You are an expert AI video prompt engineer for Seedance 2.0 (a 3D animation model). Generate a single, detailed video generation prompt that describes camera movement and scene animation for an 8-second cinematic clip. Output ONLY the prompt text in English, no explanations. Focus on: camera motion (dolly, orbit, crane), lighting changes, atmospheric effects, and smooth transitions.`,
      `Website type: ${siteType}
Topic/Theme: ${topic}
Reference image was generated with: ${imagePrompt}

Generate an 8-second 3D cinematic animation prompt that brings this scene to life with dramatic camera movement.`
    );
    res.json({ success: true, prompt });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Generate image — OpenAI (primary) → Higgsfield (fallback)
async function openaiGenerateImage(prompt, size) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size, quality: 'high' }),
      signal: controller.signal
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const b64 = data.data?.[0]?.b64_json;
    const url = data.data?.[0]?.url;
    if (url) return url;
    if (b64) {
      const imgBuf = Buffer.from(b64, 'base64');
      const fs = require('fs');
      const fname = 'generated_' + Date.now() + '.png';
      const fpath = path.join(__dirname, 'public', fname);
      fs.writeFileSync(fpath, imgBuf);
      return '/' + fname;
    }
    throw new Error('No image in response');
  } finally { clearTimeout(timeout); }
}

app.post('/api/generate-image', async (req, res) => {
  const { prompt, aspect_ratio = '16:9' } = req.body;
  const sizeMap = { '16:9': '1536x1024', '9:16': '1024x1536', '1:1': '1024x1024' };
  const size = sizeMap[aspect_ratio] || '1536x1024';

  // Try OpenAI first
  if (OPENAI_KEY) {
    try {
      console.log('[OpenAI] Generating image...');
      const url = await openaiGenerateImage(prompt, size);
      console.log('[OpenAI] Image URL:', url?.substring(0, 80));
      return res.json({ success: true, data: { url }, engine: 'openai' });
    } catch (err) {
      console.error('[OpenAI] Error:', err.message);
    }
  }

  // Fallback: Higgsfield Soul (platform.higgsfield.ai)
  if (HF_API_ID && HF_SECRET) {
    try {
      console.log('[HF] Generating image via Soul...');
      const hfSizeMap = { '16:9': '2048x1152', '9:16': '1152x2048', '1:1': '1024x1024' };
      const result = await hfApi('/v1/text2image/soul', 'POST', {
        params: { prompt, width_and_height: hfSizeMap[aspect_ratio] || '2048x1152', quality: '1080p', batch_size: 1, enhance_prompt: true }
      });
      if (result?.id) {
        const jobUrl = await pollHfJob(result.id);
        if (jobUrl) return res.json({ success: true, data: { url: jobUrl }, engine: 'higgsfield-soul' });
      }
      return res.json({ success: true, data: result, engine: 'higgsfield-soul' });
    } catch (err) {
      console.error('[HF] Error:', err.message);
    }
  }

  res.json({ success: false, error: 'No image generation API available' });
});

// Generate video via Higgsfield Seedance (platform.higgsfield.ai)
app.post('/api/generate-video', async (req, res) => {
  try {
    const { prompt, image_url, duration = 5, aspect_ratio = '16:9', model = 'seedance_lite' } = req.body;
    console.log('[HF] Generating video via Seedance...');

    const params = {
      model: model === 'seedance_pro' ? 'seedance_pro' : 'seedance_lite',
      prompt,
      duration: Math.min(duration, 10),
      enhance_prompt: true
    };
    if (image_url) {
      params.input_image = { type: 'image_url', image_url: image_url };
    }

    const result = await hfApi('/v1/image2video/seedance', 'POST', { params });
    console.log('[HF] Seedance job:', JSON.stringify(result).substring(0, 200));
    if (result?.id) {
      console.log('[HF] Polling job:', result.id);
      const videoUrl = await pollHfJob(result.id);
      if (videoUrl) return res.json({ success: true, data: { url: videoUrl }, engine: 'higgsfield-seedance' });
    }
    res.json({ success: true, data: result, engine: 'higgsfield-seedance' });
  } catch (err) {
    console.error('[HF] Video error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// Check job status
app.get('/api/status/:jobId', async (req, res) => {
  try {
    const result = await hfApi(`/v1/jobs/${req.params.jobId}`, 'GET');
    res.json({ success: true, data: result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// List recent generations
app.get('/api/generations/:type', async (req, res) => {
  try {
    const result = await hfApi(`/v1/generations?type=${req.params.type}&size=5`, 'GET');
    res.json({ success: true, data: result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Deploy to GitHub via GitHub API
app.post('/api/deploy-github', async (req, res) => {
  try {
    const { repoUrl, branch = 'main', commitMessage = 'Deploy website via SiteForge', html, enablePages } = req.body;
    if (!repoUrl || !html) return res.json({ success: false, error: 'Repository URL and HTML required' });

    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s.]+)/);
    if (!match) return res.json({ success: false, error: 'Invalid GitHub URL format' });
    const [, owner, repo] = match;
    const repoName = repo.replace(/\.git$/, '');

    const { execSync } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteforge-'));

    console.log(`[GH] Deploying to ${owner}/${repoName} branch:${branch}`);

    const run = (cmd) => execSync(cmd, { cwd: tmpDir, stdio: 'pipe', timeout: 30000 }).toString().trim();

    run('git init');
    run(`git remote add origin https://github.com/${owner}/${repoName}.git`);

    try {
      run(`git fetch origin ${branch} --depth=1`);
      run(`git checkout ${branch}`);
    } catch {
      run(`git checkout -b ${branch}`);
    }

    fs.writeFileSync(path.join(tmpDir, 'index.html'), html, 'utf8');

    const nojekyll = path.join(tmpDir, '.nojekyll');
    if (!fs.existsSync(nojekyll)) fs.writeFileSync(nojekyll, '', 'utf8');

    run('git add -A');

    try {
      run(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
    } catch (e) {
      if (e.toString().includes('nothing to commit')) {
        return res.json({ success: true, message: 'No changes to commit', url: `https://github.com/${owner}/${repoName}` });
      }
      throw e;
    }

    run(`git push -u origin ${branch}`);

    let pagesUrl = '';
    if (enablePages) {
      pagesUrl = `https://${owner}.github.io/${repoName}/`;
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(`[GH] Deploy complete: ${owner}/${repoName}`);
    res.json({
      success: true,
      message: 'Deployed successfully',
      url: `https://github.com/${owner}/${repoName}`,
      pagesUrl
    });
  } catch (err) {
    console.error('[GH] Deploy error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Website Generator running at http://localhost:${PORT}`);
  console.log(`Higgsfield API: ${HF_API_ID && HF_SECRET ? 'configured' : 'NOT SET'}`);
  console.log(`Claude API: ${CLAUDE_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`OpenAI API: ${OPENAI_KEY ? 'configured' : 'NOT SET'}`);
});
