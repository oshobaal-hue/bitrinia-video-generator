/**
 * bitrinia-video-generator/server.js
 * CommonJS - compatible con Alpine + Railway
 * POST /generate => slideshow MP4 con overlay de texto
 */

const express = require('express');
const { execSync } = require('child_process');
const { unlinkSync, existsSync, mkdirSync, statSync, readdirSync, rmdirSync, createWriteStream } = require('fs');
const { join, dirname } = require('path');
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

app.post('/generate', async (req, res) => {
  const jobId = randomUUID().slice(0,8);
  const { images, title, price, store, cta, color } = req.body;
  if (!images||!Array.isArray(images)||images.length===0) return res.status(400).json({error:'imagenes requeridas'});
  if (images.length>10) return res.status(400).json({error:'max 10 imagenes'});
  const d = join(TMP_DIR, jobId);
  mkdirSync(d, { recursive: true });
  const out = join(d, 'out.mp4');
  try {
    const dl = images.map((u,i) => { const e=(u.match(/\.(png|jpg|jpeg|webp)/i)||[,'jpg'])[1]; return downloadImage(u, join(d,`i${i}.${e}`)); });
    const paths = await Promise.all(dl);
    const T = paths.length, W = 1080, H = 1920;
    let fc = paths.map((_,i)=>`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,setpts=PTS-STARTPTS+${i*3}/TB[v${i}];`).join('');
    fc += paths.map((_,i)=>`[v${i}]`).join('')+`concat=n=${T}:v=1:a=0,format=yuv420p[v];`;
    fc += `[v]drawbox=x=0:y=H-400:w=W:h=400:color=black@0.6:t=fill[z];`;
    const c1=(color||'#6B21A8').replace('#','');
    if (store) fc+=`[z]drawtext=text='${esc(store)}':x=(W-text_w)/2:y=100:fontsize=48:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[z1];`; else fc+=`[z]copy[z1];`;
    if (title) fc+=`[z1]drawtext=text='${esc(title)}':x=(W-text_w)/2:y=H-350:fontsize=64:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[z2];`; else fc+=`[z1]copy[z2];`;
    if (price) fc+=`[z2]drawtext=text='${esc(String(price))}':x=(W-text_w)/2:y=H-250:fontsize=72:fontcolor='#${c1}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[z3];`; else fc+=`[z2]copy[z3];`;
    fc+=`[z3]drawtext=text='${esc(cta||'Compra ahora')}':x=(W-text_w)/2:y=H-140:fontsize=40:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf[o];`;
    const cmd = `ffmpeg -y ${paths.flatMap(p=>['-i',p]).join(' ')} -filter_complex "${fc}" -map '[o]' -c:v libx264 -preset ultrafast -crf 26 -r 30 -pix_fmt yuv420p -movflags +faststart -t ${T*3} -threads 2 ${out}`;
    const start = Date.now(); execSync(cmd, { timeout: 180000 });
    console.log(`[${jobId}] ${((Date.now()-start)/1000).toFixed(1)}s - ${(statSync(out).size/1024/1024).toFixed(1)}MB`);
    res.download(out, `${(store||'video').replace(/\s+/g,'_').toLowerCase()}_${jobId}.mp4`, ()=>{ try { paths.forEach(p=>{try{unlinkSync(p)}catch{}}); try{unlinkSync(out)}catch{}; try{rmdirSync(d)}catch{} } catch {} });
  } catch (e) {
    console.error(`[${jobId}] ${e.message}`);
    try { readdirSync(d).forEach(f=>{try{unlinkSync(join(d,f))}catch{}}); try{rmdirSync(d)}catch{} } catch {}
    res.status(500).json({error:'error', detail: e.message});
  }
});

app.get('/health', (_req, res) => {
  let v='no'; try { v=execSync('ffmpeg -version',{timeout:5000}).toString().split('\n')[0]; } catch {}
  res.json({status:'ok', service:'bitrinia-video-generator', ffmpeg: v});
});

const PORT = parseInt(process.env.PORT||'3001',10);
app.listen(PORT, ()=>console.log(`[video-gen] puerto ${PORT}`));
