/**
 * bitrinia-video-generator/server.js
 * Video profesional con Ken Burns, crossfade, texto animado y branding
 * POST /generate => MP4 profesional de 15s
 */

const express = require('express');
const { execSync } = require('child_process');
const { unlinkSync, existsSync, mkdirSync, statSync, readdirSync, rmdirSync, createWriteStream } = require('fs');
const { join } = require('path');
const { randomUUID } = require('crypto');
const https = require('https');
const http = require('http');

const TMP_DIR = join(__dirname, 'tmp');
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '10mb' }));

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = createWriteStream(dest);
    proto.get(url, (r) => {
      if (r.statusCode !== 200) return reject(new Error(`HTTP ${r.statusCode}`));
      r.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', (e) => { try { unlinkSync(dest); } catch {} reject(e); });
  });
}

function esc(s) {
  return (s||'').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/\[/g,'\\[').replace(/\]/g,'\\]');
}

/**
 * Construye el filter_complex de ffmpeg con todos los efectos:
 * - Ken Burns zoom (1.0x -> 1.15x)
 * - Fade in/out por slide
 * - Texto animado (logo slide down, title slide up, price pulse, CTA fade)
 * - Crossfade entre slides
 * - Logo overlay
 * - Branding bitrinia.com
 */
function buildFilterComplex(N, W, H, store, title, price, ctaText, color, D, crossfade, hasLogo) {
  const c1 = (color||'#6B21A8').replace('#','');
  const totalFrames = Math.round(D * 30);
  // Calcular el incremento de zoom por frame en JS (max() no es válido en ffmpeg)
  const zoomStep = (0.15 / Math.max(1, totalFrames - 1)).toFixed(8);
  let fc = '';

  for (let i = 0; i < N; i++) {
    // Ken Burns zoom (1.0x -> 1.15x lento)
    fc += `[${i}:v]zoompan=z='min(1.15,1.0+${zoomStep}*n)':d=${totalFrames}:s=${W}x${H}:fps=30`;

    // Escalar y centrar
    fc += `,scale=${W}:${H}:force_original_aspect_ratio=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0`;

    // Fade in / out por slide
    fc += `,fade=t=in:st=0:d=0.4:color=black`;
    fc += `,fade=t=out:st=${D-0.4}:d=0.4:color=black`;

    // Logo tienda: slide down 0.0s->0.6s
    if (store) {
      const logoY = `if(lte(t,0.6),-100+(100+80)*(t/0.6),80)`;
      fc += `,drawtext=text='${esc(store)}':x=(W-text_w)/2:y='${logoY}':fontsize=48:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:shadowcolor=black@0.5:shadowx=2:shadowy=2`;
    }

    // Nombre producto: slide up 0.5s->1.3s
    if (title) {
      const titleY = `if(lte(t,0.5),${H+50},if(lte(t,1.3),${H+50}-(${H+50}-${H-380})*((t-0.5)/0.8),${H-380}))`;
      fc += `,drawtext=text='${esc(title)}':x=(W-text_w)/2:y='${titleY}':fontsize=60:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:shadowcolor=black@0.5:shadowx=3:shadowy=3`;
    }

    // Precio: pulse effect desde 1.2s
    if (price) {
      const priceFs = `if(lte(t,1.2),0,if(lte(t,1.8),72*(t-1.2)/0.6,72+6*sin(2*PI*4*t)))`;
      fc += `,drawtext=text='${esc(String(price))}':x=(W-text_w)/2:y=${H-260}:fontsize='${priceFs}':fontcolor='#${c1}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:shadowcolor=black@0.5:shadowx=3:shadowy=3`;
    }

    // CTA: fade in desde 2.0s
    if (ctaText) {
      const ctaAlpha = `if(lte(t,2.0),0,min(1,(t-2.0)/0.6))`;
      fc += `,drawtext=text='${esc(ctaText)}':x=(W-text_w)/2:y=${H-140}:fontsize=40:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:alpha='${ctaAlpha}':shadowcolor=black@0.5:shadowx=2:shadowy=2`;
    }

    // Branding bitrinia.com (siempre visible)
    fc += `,drawtext=text='bitrinia.com':x=(W-text_w)/2:y=${H-50}:fontsize=22:fontcolor=white@0.4:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:shadowcolor=black@0.3:shadowx=1:shadowy=1`;

    fc += `[v${i}];`;
  }

  // Crossfade chain
  let finalSrc = 'v0';
  if (N > 1) {
    let prev = 'v0';
    for (let j = 1; j < N; j++) {
      const outLabel = (j === N-1) ? 'merged' : 'm'+j;
      const offset = j * (D - crossfade);
      fc += `[${prev}][v${j}]xfade=transition=fade:duration=${crossfade}:offset=${offset}[${outLabel}];`;
      prev = outLabel;
    }
    finalSrc = 'merged';
  }

  // Logo overlay (esquina superior derecha)
  if (hasLogo) {
    fc += `[${finalSrc}][${N}:v]overlay=W-w-30:30,format=yuv420p[o];`;
  } else {
    fc += `[${finalSrc}]format=yuv420p[o];`;
  }

  return fc;
}

app.post('/generate', async (req, res) => {
  const jobId = randomUUID().slice(0,8);
  const { images, title, price, store, cta, color, logo_url } = req.body;

  if (!images||!Array.isArray(images)||images.length===0)
    return res.status(400).json({error:'imagenes requeridas'});
  if (images.length>10)
    return res.status(400).json({error:'max 10 imagenes'});

  const d = join(TMP_DIR, jobId);
  mkdirSync(d, { recursive: true });
  const out = join(d, 'out.mp4');

  try {
    // Descargar imágenes
    const imgPromises = images.map((u,i) => {
      const ext = (u.match(/\.(png|jpg|jpeg|webp)/i)||[,'jpg'])[1];
      return downloadImage(u, join(d,`i${i}.${ext}`));
    });
    const imgPaths = await Promise.all(imgPromises);

    // Descargar logo si existe
    let logoPath = null;
    if (logo_url) {
      try {
        logoPath = join(d, 'logo.png');
        await downloadImage(logo_url, logoPath);
      } catch (e) {
        console.log(`[${jobId}] Logo no disponible, continuando sin: ${e.message}`);
        logoPath = null;
      }
    }

    const W = 1080, H = 1920;
    const crossfade = 0.5;
    const N = imgPaths.length;

    // Duración por slide: siempre ~15s total
    let D;
    if (N === 1) {
      D = 15; // Una sola imagen, 15s de zoom continuo
    } else {
      // Total = N*D - (N-1)*crossfade >= 15
      D = Math.max(3, Math.ceil(((15 + (N-1)*crossfade) / N) * 10) / 10);
    }

    // Construir filter complex
    const ctaText = cta || 'Compra ahora';
    const fc = buildFilterComplex(N, W, H, store, title, price, ctaText, color, D, crossfade, !!logoPath);

    // Armar inputs ffmpeg
    const allInputs = [...imgPaths];
    if (logoPath) allInputs.push(logoPath);
    const inputs = allInputs.flatMap(p => ['-i', p]).join(' ');
    const totalDur = N === 1 ? D : (N * D - (N-1) * crossfade);

    const cmd = `ffmpeg -y ${inputs} -filter_complex "${fc}" -map '[o]' -c:v libx264 -preset ultrafast -crf 28 -r 30 -pix_fmt yuv420p -movflags +faststart -t ${totalDur+0.5} -threads 2 ${out}`;

    console.log(`[${jobId}] == Generando: ${N} img, ${totalDur.toFixed(1)}s, ${D.toFixed(1)}s/slide ==`);
    const start = Date.now();
    execSync(cmd, { timeout: 300000 });
    const elapsed = ((Date.now()-start)/1000).toFixed(1);
    const size = (statSync(out).size/1024/1024).toFixed(1);
    console.log(`[${jobId}] == ${elapsed}s - ${size}MB ==`);

    res.download(out, `${(store||'video').replace(/\s+/g,'_').toLowerCase()}_${jobId}.mp4`, () => {
      try { allInputs.forEach(p=>{try{unlinkSync(p)}catch{}}); } catch {}
      try { unlinkSync(out); } catch {}
      try { rmdirSync(d); } catch {}
    });
  } catch (e) {
    console.error(`[${jobId}] Error: ${e.message}`);
    try {
      readdirSync(d).forEach(f=>{try{unlinkSync(join(d,f))}catch{}});
      try{rmdirSync(d)}catch{}
    } catch {}
    res.status(500).json({error:'error generando video', detail: e.message});
  }
});

app.get('/health', (_req, res) => {
  let v='no';
  try { v=execSync('ffmpeg -version',{timeout:5000}).toString().split('\n')[0]; } catch {}
  res.json({status:'ok', service:'bitrinia-video-generator', ffmpeg: v});
});

const PORT = parseInt(process.env.PORT||'3001',10);
app.listen(PORT, ()=>console.log(`[video-gen] puerto ${PORT}`));
