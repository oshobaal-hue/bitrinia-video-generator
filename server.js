/**
 * autolents-convert-service/server.js
 *
 * Servidor Express para Railway que convierte WebM → MP4
 * usando ffmpeg nativo (instalado en el contenedor).
 *
 * Uso:
 *   POST /convert  (multipart/form-data, campo "video")
 *   → Devuelve el MP4 directamente como respuesta.
 */

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { execSync } from 'child_process';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, 'tmp');

// Asegurar que el directorio temporal existe
if (!existsSync(TMP_DIR)) {
  mkdirSync(TMP_DIR, { recursive: true });
}

// ── Multer: almacenamiento temporal ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename: (_req, file, cb) => {
    const ext = file.mimetype === 'video/webm' ? '.webm' : '.webm';
    cb(null, `input_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB máximo
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'video/webm' || file.originalname.endsWith('.webm')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos WebM'));
    }
  },
});

// ── Express ────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ── POST /convert ──────────────────────────────────────────────────────────────
app.post('/convert', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      console.error('[convert] ❌ Error en upload:', err.message);
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo' });
    }

    const inputPath  = req.file.path;
    const outputPath = inputPath.replace(/\.webm$/, '') + '.mp4';

    console.log(`[convert] 🔄 Convirtiendo: ${inputPath} → ${outputPath}`);

    try {
      const startTime = Date.now();

      // ── Ejecutar ffmpeg nativo ─────────────────────────────────────────
      //   Railway tiene ffmpeg instalado por defecto en el contenedor.
      //   Flags optimizados para Reels/TikTok (9:16 vertical).
      // ── Flags optimizadas para Railway (512MB RAM) ──────────────
      //   ultrafast + threads 2 evita OOM (Out of Memory)
      //   crf 28 es calidad aceptable para Reels/TikTok
      const cmd = [
        'ffmpeg',
        '-y',
        '-i', inputPath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-r', '30',
        '-vsync', 'cfr',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        '-threads', '2',
        outputPath,
      ].join(' ');

      console.log(`[convert] 🎬 Ejecutando: ${cmd}`);
      execSync(cmd, { timeout: 120_000 }); // timeout 2 min
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[convert] ✅ Conversión completada en ${elapsed}s`);

      // ── Enviar el MP4 como respuesta ────────────────────────────────────
      res.download(outputPath, 'autolents-reel.mp4', (downloadErr) => {
        // Limpiar archivos temporales
        try { unlinkSync(inputPath); }  catch {}
        try { unlinkSync(outputPath); } catch {}

        if (downloadErr) {
          console.error('[convert] ❌ Error al enviar MP4:', downloadErr.message);
        }
      });
    } catch (convErr) {
      console.error('[convert] ❌ Error en conversión ffmpeg:', convErr.message);
      // Intentar enviar stack trace
      const detail = convErr.stderr?.toString() || convErr.message;
      res.status(500).json({ error: 'Error en conversión', detail });

      // Limpiar archivo de entrada
      try { unlinkSync(inputPath); } catch {}
    }
  });
});

// ── GET /health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'autolents-convert-service' });
});

// ── Iniciar ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, () => {
  console.log(`[convert] 🚀 Servidor corriendo en puerto ${PORT}`);
});
