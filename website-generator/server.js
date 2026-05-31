require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const app = express();
const PORT = 3847;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const HF_KEY = process.env.HIGGSFIELD_API_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Higgsfield API call
async function hfApi(endpoint, method, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`https://api.higgsfield.ai/api${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_KEY}`
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

  // Fallback: Higgsfield
  if (HF_KEY) {
    try {
      console.log('[HF] Generating image (fallback)...');
      const result = await hfApi('/v1/generate/image', 'POST', { model: 'gpt_image_2', prompt, aspect_ratio, count: 1 });
      return res.json({ success: true, data: result, engine: 'higgsfield' });
    } catch (err) {
      console.error('[HF] Error:', err.message);
    }
  }

  res.json({ success: false, error: 'No image generation API available' });
});

// Generate video via Higgsfield
app.post('/api/generate-video', async (req, res) => {
  try {
    const { prompt, image_url, duration = 8, aspect_ratio = '16:9' } = req.body;
    console.log('[HF] Generating video...');

    let medias = [];
    if (image_url) {
      medias = [{ value: image_url, role: 'start_image' }];
    }

    const result = await hfApi('/v1/generate/video', 'POST', {
      model: 'seedance_2_0',
      prompt,
      medias,
      duration,
      aspect_ratio
    });
    console.log('[HF] Video result:', JSON.stringify(result).substring(0, 200));
    res.json({ success: true, data: result });
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
  console.log(`Higgsfield API: ${HF_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`Claude API: ${CLAUDE_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`OpenAI API: ${OPENAI_KEY ? 'configured' : 'NOT SET'}`);
});
