/**
 * bitrinia-video-generator/server.js
 * Layout 50/25/25: Imagen (50%) + Texto IA (25%) + Branding (25%)
 * POST /generate => MP4 promocional
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

function buildFilterComplex(N, W, H, store, title, description, price, ctaText, color, D, crossfade) {
  const c1 = (color||'#6B21A8').replace('#','');
  const totalFrames = Math.round(D * 30);
  const zoomStep = (0.15 / Math.max(1, totalFrames - 1)).toFixed(8);

  // Layout constants
  const IMG_H = 960;   // 50%
  const TEXT_H = 480;  // 25%
  const BRAND_H = 480; // 25%
  const TEXT_Y = 960;
  const BRAND_Y = 1440;

  let fc = '';

  for (let i = 0; i < N; i++) {
    const slideLabel = `v${i}`;

    // 1. Imagen con Ken Burns zoom en 50% superior
    fc += `[${i}:v]`;
    fc += `zoompan=z='1.0+${zoomStep}*on':d=${totalFrames}:s=${W}x${IMG_H}:fps=30,`;
    fc += `scale=${W}:${IMG_H}:force_original_aspect_ratio=1,pad=${W}:${IMG_H}:(ow-iw)/2:(oh-ih)/2:color=black@0,`;
    // Gradiente oscuro abajo
    fc += `drawbox=x=0:y=${IMG_H-80}:w=${W}:h=80:color=black@0.4:t=fill`;
    // Fade in/out slide
    fc += `,fade=t=in:st=0:d=0.4:color=black`;
    fc += `,fade=t=out:st=${D-0.4}:d=0.4:color=black`;
    fc += `[${slideLabel}];`;

    // 2. Text zone background (25% medio, oscuro)
    const textBgLabel = `txtbg${i}`;
    fc += `color=c=0x0a0a0a:s=${W}x${TEXT_H}:d=${D}[${textBgLabel}];`;

    // 3. Brand zone background (25% inferior, más oscuro)
    const brandBgLabel = `brbg${i}`;
    fc += `color=c=0x050505:s=${W}x${BRAND_H}:d=${D}[${brandBgLabel}];`;

    // Texto en zona media
    let txtStream = `${textBgLabel}`;
    const txtOut = `txt${i}`;

    // Nombre tienda (fade in, arriba del texto zone)
    if (store) {
      fc += `[${txtStream}]drawtext=text='${esc(store.toUpperCase())}':x=(W-text_w)/2:y=30:fontsize=22:fontcolor=#888888:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:alpha='if(lte(t,0.4),t/0.4,1)'[t1_${i}];`;
      txtStream = `t1_${i}`;
    }

    // Headline (slide up 0.3s → 0.9s)
    if (title) {
      fc += `[${txtStream}]drawtext=text='${esc(title)}':x=(W-text_w)/2:y='if(lte(t,0.3),${TEXT_H+30},if(lte(t,0.9),${TEXT_H+30}-(${TEXT_H+30}-50)*((t-0.3)/0.6),50))':fontsize=44:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:shadowcolor=black@0.3:shadowx=2:shadowy=2[t2_${i}];`;
      txtStream = `t2_${i}`;
    }

    // Descripción (fade in 1.0s →)
    if (description) {
      fc += `[${txtStream}]drawtext=text='${esc(description)}':x=(W-text_w)/2:y=120:fontsize=26:fontcolor=#cccccc:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:alpha='if(lte(t,1.0),0,if(lte(t,1.8),(t-1.0)/0.8,1))':shadowcolor=black@0.2:shadowx=1:shadowy=1[t3_${i}];`;
      txtStream = `t3_${i}`;
    }

    // Precio (pulse desde 1.8s)
    if (price) {
      fc += `[${txtStream}]drawtext=text='${esc(String(price))}':x=(W-text_w)/2:y=${TEXT_H-70}:fontsize='if(lte(t,1.8),0,if(lte(t,2.3),56*(t-1.8)/0.5,56+4*sin(2*PI*4*t)))':fontcolor=#${c1}:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:shadowcolor=black@0.3:shadowx=2:shadowy=2[t4_${i}];`;
      txtStream = `t4_${i}`;
    }

    // CTA: botón simulado con fade in (2.5s →)
    const btnX = (W-320)/2;
    const btnY = TEXT_H-110;
    if (ctaText) {
      // Botón de fondo redondeado
      fc += `[${txtStream}]drawbox=x=${btnX}:y=${btnY}:w=320:h=44:color=#${c1}@'if(lte(t,2.5),0,min(1,(t-2.5)/0.5))':t=fill,`;
      fc += `drawtext=text='${esc(ctaText)}':x=${W/2}:y=${btnY+22}:fontsize=24:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text_align=C:alpha='if(lte(t,2.5),0,min(1,(t-2.5)/0.5))'[t5_${i}];`;
      txtStream = `t5_${i}`;
    }

    // Renombrar salida final de texto
    if (txtStream !== `t5_${i}` && txtStream !== `t4_${i}` && txtStream !== `t3_${i}` && txtStream !== `t2_${i}` && txtStream !== `t1_${i}` && txtStream !== `${textBgLabel}`) {
    } else {
      // La última transformación ya generó un stream etiquetado; lo renombramos
      if (!txtStream.startsWith('t5_') && !txtStream.startsWith('t4_') && !txtStream.startsWith('t3_') && !txtStream.startsWith('t2_') && !txtStream.startsWith('t1_')) {
        // Si no hay CTA, el último stream fue t4_; si no hay price, t3_; etc.
        // Necesitamos saber cuál es el último
      }
    }
    // Forzamos un alias para simplificar
    fc += `[${txtStream}]copy[final_txt_${i}];`;

    // Texto en zona de branding (nombre tienda + bitrinia.com)
    let brStream = brandBgLabel;
    if (store) {
      fc += `[${brStream}]drawtext=text='✨ ${esc(store)}':x=(W-text_w)/2:y=160:fontsize=30:fontcolor=white@'if(lte(t,0.5),0,min(0.7,(t-0.5)/0.5*0.7))':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:shadowcolor=black@0.2:shadowx=1:shadowy=1[br1_${i}];`;
      brStream = `br1_${i}`;
    }
    // Línea divisoria
    fc += `[${brStream}]drawbox=x=60:y=0:w=${W-120}:h=1:color=white@0.04:t=fill,`;
    // bitrinia.com
    fc += `drawtext=text='bitrinia.com':x=(W-text_w)/2:y=340:fontsize=18:fontcolor=#aaaaaa@'if(lte(t,0.8),0,min(0.35,(t-0.8)/0.5*0.35))':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf[final_br_${i}];`;

    // Stack: imagen (IMG_H) + texto (TEXT_H) + branding (BRAND_H)
    fc += `[${slideLabel}][final_txt_${i}][final_br_${i}]vstack=inputs=3[s${i}];`;
  }

  // Crossfade chain entre slides apiladas
  if (N === 1) {
    fc += `[s0]format=yuv420p[o];`;
  } else {
    let prev = 's0';
    for (let j = 1; j < N; j++) {
      const outLabel = (j === N-1) ? 'merged' : 'x'+j;
      const offset = j * (D - crossfade);
      fc += `[${prev}][s${j}]xfade=transition=fade:duration=${crossfade}:offset=${offset}[${outLabel}];`;
      prev = outLabel;
    }
    fc += `[merged]format=yuv420p[o];`;
  }

  return fc;
}

app.post('/generate', async (req, res) => {
  const jobId = randomUUID().slice(0,8);
  const { images, title, description, price, store, cta, color } = req.body;

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

    const W = 1080, H = 1920;
    const crossfade = 0.5;
    const N = imgPaths.length;

    let D;
    if (N === 1) {
      D = 15;
    } else {
      D = Math.max(3, Math.ceil(((15 + (N-1)*crossfade) / N) * 10) / 10);
    }

    const ctaText = cta || 'Compra ahora';
    const fc = buildFilterComplex(N, W, H, store, title, description, price, ctaText, color, D, crossfade);

    const inputs = imgPaths.flatMap(p => ['-i', p]).join(' ');
    const totalDur = N === 1 ? D : (N * D - (N-1) * crossfade);

    const cmd = `ffmpeg -y ${inputs} -filter_complex "${fc}" -map '[o]' -c:v libx264 -preset ultrafast -crf 28 -r 30 -pix_fmt yuv420p -movflags +faststart -t ${totalDur+0.5} -threads 2 ${out}`;

    console.log(`[${jobId}] == Generando: ${N} img, ${totalDur.toFixed(1)}s, ${D.toFixed(1)}s/slide ==`);
    if (description) console.log(`[${jobId}] Descripción IA: ${description.substring(0,60)}...`);
    const start = Date.now();
    execSync(cmd, { timeout: 300000 });
    const elapsed = ((Date.now()-start)/1000).toFixed(1);
    const size = (statSync(out).size/1024/1024).toFixed(1);
    console.log(`[${jobId}] == ${elapsed}s - ${size}MB ==`);

    res.download(out, `${(store||'video').replace(/\s+/g,'_').toLowerCase()}_${jobId}.mp4`, () => {
      try { imgPaths.forEach(p=>{try{unlinkSync(p)}catch{}}); } catch {}
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
