// server.js - Backend Optimizado SIN Twitter API (100% Gratis)
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: ['media:content', 'media:thumbnail']
  }
});
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./noticias.db', (err) => {
  if (err) console.error('Error al abrir base de datos:', err);
  else console.log('✅ Base de datos conectada');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS noticias (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    resumen TEXT,
    url TEXT UNIQUE NOT NULL,
    fuente TEXT,
    categoria TEXT,
    localidades TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    hash TEXT UNIQUE,
    imagenUrl TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON noticias(timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_categoria ON noticias(categoria)`);
});

const KEYWORDS = {
  principal: ['rocha', 'departamento de rocha'],
  localidades: [
    'la paloma', 'la pedrera', 'barra de valizas', 'punta del diablo',
    'aguas dulces', 'chuy', 'castillos', 'lascano', 'cebollatí',
    '19 de abril', 'la coronilla', 'cabo polonio', 'valizas', 'la esmeralda'
  ],
  categorias: {
    turismo: ['turismo', 'playa', 'temporada', 'guardavidas', 'hotel', 'visitantes', 'balneario'],
    politica: ['intendencia', 'municipio', 'intendente', 'alcalde', 'junta', 'edil', 'gobierno'],
    seguridad: ['policía', 'bomberos', 'siniestro', 'accidente', 'rapiña', 'hurto', 'rescate'],
    deportes: ['rocha fc', 'fútbol', 'deporte', 'campeonato', 'torneo'],
    eventos: ['festival', 'evento', 'feria', 'concierto', 'espectáculo', 'carnaval'],
    ambiente: ['medio ambiente', 'playa', 'ecosistema', 'fauna']
  }
};

const FUENTES = [
  // ===== GOOGLE NEWS (Siempre funciona, incluye tweets virales) =====
  {
    nombre: 'Google News - Rocha',
    url: 'https://news.google.com/rss/search?q=Rocha+Uruguay+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Google News - La Paloma',
    url: 'https://news.google.com/rss/search?q=%22La+Paloma%22+Rocha+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Google News - Punta del Diablo',
    url: 'https://news.google.com/rss/search?q=%22Punta+del+Diablo%22+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Google News - Cabo Polonio',
    url: 'https://news.google.com/rss/search?q=%22Cabo+Polonio%22+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'alta'
  },
  {
    nombre: 'Google News - Chuy',
    url: 'https://news.google.com/rss/search?q=Chuy+Uruguay+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'alta'
  },
  {
    nombre: 'Google News - Barra de Valizas',
    url: 'https://news.google.com/rss/search?q=%22Barra+de+Valizas%22+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'media'
  },

  // ===== FUENTES LOCALES ROCHA =====
  {
    nombre: 'Rocha Noticias',
    url: 'https://rochanoticias.com',
    tipo: 'scraping',
    selector: '.post-title a, .entry-title a, article h2 a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Rocha al Día',
    url: 'https://rochaaldia.com',
    tipo: 'scraping',
    selector: '.post-title a, .entry-title a, h2 a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Rocha Total',
    url: 'https://rochatotal.com',
    tipo: 'scraping',
    selector: '.entry-title a, article h2 a',
    prioridad: 'alta'
  },

  // ===== MEDIOS NACIONALES =====
  {
    nombre: 'El Observador',
    url: 'https://www.elobservador.com.uy/buscar?q=rocha',
    tipo: 'scraping',
    selector: '.story-title a, article h2 a, .headline a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Montevideo Portal',
    url: 'https://www.montevideo.com.uy/Noticias/Rocha',
    tipo: 'scraping',
    selector: '.article-title a, .listanoticias a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'La Diaria',
    url: 'https://ladiaria.com.uy/buscar/?q=rocha',
    tipo: 'scraping',
    selector: 'article h2 a, .article-title a',
    prioridad: 'alta'
  },

  // ===== FACEBOOK (Comentado - bloqueado por anti-bot) =====
  // Si quieres activarlo, descomenta estas líneas pero puede dar errores 400
  /*
  {
    nombre: 'Facebook - Rocha Noticias',
    url: 'https://m.facebook.com/rochanoticias',
    tipo: 'facebook',
    prioridad: 'baja'
  },
  */

  // ===== FUENTES OFICIALES =====
  {
    nombre: 'Intendencia de Rocha',
    url: 'https://rocha.gub.uy',
    tipo: 'scraping',
    selector: '.noticia-titulo a, article h2 a',
    prioridad: 'media'
  },
  {
    nombre: 'Turismo Rocha',
    url: 'https://www.turismorocha.gub.uy',
    tipo: 'scraping',
    selector: '.news-title a, article h2 a',
    prioridad: 'media'
  }
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function generarHash(texto) {
  return crypto.createHash('md5').update(texto.toLowerCase().trim()).digest('hex');
}

function detectarLocalidades(texto) {
  const localidadesEncontradas = [];
  const textoLower = texto.toLowerCase();
  KEYWORDS.localidades.forEach(loc => {
    if (textoLower.includes(loc)) localidadesEncontradas.push(loc);
  });
  return localidadesEncontradas;
}

function detectarCategoria(texto) {
  const textoLower = texto.toLowerCase();
  for (const [categoria, keywords] of Object.entries(KEYWORDS.categorias)) {
    for (const keyword of keywords) {
      if (textoLower.includes(keyword)) return categoria;
    }
  }
  return 'general';
}

function contieneKeywords(texto) {
  const textoLower = texto.toLowerCase();
  return KEYWORDS.principal.some(kw => textoLower.includes(kw)) ||
         KEYWORDS.localidades.some(loc => textoLower.includes(loc));
}

function esNoticiaReciente(fechaStr) {
  if (!fechaStr) return true;
  try {
    const fechaNoticia = new Date(fechaStr);
    const ahora = new Date();
    const diasDiferencia = (ahora - fechaNoticia) / (1000 * 60 * 60 * 24);
    return diasDiferencia <= 7;
  } catch {
    return true;
  }
}

function limpiarTexto(texto) {
  if (!texto) return texto;
  return texto.replace(/https?:\/\/[^\s]+/g, '')
              .replace(/^RT\s+/i, '')
              .replace(/\s+/g, ' ')
              .trim();
}

async function scrapearSitio(fuente) {
  try {
    console.log(`📡 ${fuente.nombre}`);
    
    const response = await axios.get(fuente.url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-UY,es;q=0.9',
        'Connection': 'keep-alive'
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    if (response.status >= 400) {
      console.log(`⚠️ ${fuente.nombre}: HTTP ${response.status}`);
      return [];
    }

    const $ = cheerio.load(response.data);
    const noticias = [];
    const visitedUrls = new Set();

    $(fuente.selector).each((i, elem) => {
      if (i >= 30) return false;
      
      const titulo = $(elem).text().trim();
      let url = $(elem).attr('href');
      
      if (!url || !titulo) return;
      
      if (url.startsWith('/')) {
        const baseUrl = new URL(fuente.url);
        url = `${baseUrl.protocol}//${baseUrl.host}${url}`;
      } else if (!url.startsWith('http')) {
        return;
      }
      
      if (visitedUrls.has(url)) return;
      visitedUrls.add(url);
      
      if (contieneKeywords(titulo)) {
        noticias.push({
          titulo: titulo.substring(0, 200),
          url,
          fuente: fuente.nombre
        });
      }
    });

    console.log(`✅ ${fuente.nombre}: ${noticias.length} noticias`);
    return noticias;
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      console.error(`❌ ${fuente.nombre}: Dominio no existe`);
    } else {
      console.error(`❌ ${fuente.nombre}: ${error.message}`);
    }
    return [];
  }
}

async function parsearRSS(fuente) {
  try {
    console.log(`📡 ${fuente.nombre}`);
    const feed = await parser.parseURL(fuente.url);
    const noticias = [];
    const visitedUrls = new Set();

    feed.items.forEach((item, i) => {
      if (i >= 30) return;
      
      const titulo = item.title || '';
      const resumen = item.contentSnippet || item.description || '';
      const textoCompleto = `${titulo} ${resumen}`;
      const url = item.link || item.guid;
      const fecha = item.pubDate || item.isoDate;
      
      if (!url || visitedUrls.has(url)) return;
      visitedUrls.add(url);
      
      if (!esNoticiaReciente(fecha)) return;
      
      if (contieneKeywords(textoCompleto)) {
        noticias.push({
          titulo: limpiarTexto(titulo).substring(0, 200),
          url,
          resumen: limpiarTexto(resumen).substring(0, 400),
          fuente: fuente.nombre,
          fechaPublicacion: fecha
        });
      }
    });

    console.log(`✅ ${fuente.nombre}: ${noticias.length} noticias`);
    return noticias;
  } catch (error) {
    console.error(`❌ ${fuente.nombre}: ${error.message}`);
    return [];
  }
}

async function scrapearFacebook(fuente) {
  try {
    console.log(`📘 ${fuente.nombre}`);
    
    const response = await axios.get(fuente.url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-UY,es;q=0.9'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const noticias = [];
    const visitedUrls = new Set();

    $('article, div[data-ft]').each((i, elem) => {
      if (i >= 20) return false;
      
      const texto = $(elem).text().trim();
      const linkElem = $(elem).find('a[href*="/posts/"], a[href*="/story.php"]').first();
      
      if (!linkElem.length || !texto) return;
      
      let url = linkElem.attr('href');
      if (url.startsWith('/')) url = 'https://m.facebook.com' + url;
      
      if (visitedUrls.has(url)) return;
      visitedUrls.add(url);
      
      if (contieneKeywords(texto)) {
        noticias.push({
          titulo: texto.substring(0, 200),
          url: url.split('?')[0],
          fuente: fuente.nombre
        });
      }
    });

    console.log(`✅ ${fuente.nombre}: ${noticias.length} posts`);
    return noticias;
  } catch (error) {
    console.error(`❌ ${fuente.nombre}: ${error.message}`);
    return [];
  }
}

function guardarNoticia(noticia) {
  return new Promise((resolve, reject) => {
    const hash = generarHash(noticia.titulo);
    const localidades = JSON.stringify(detectarLocalidades(noticia.titulo + ' ' + (noticia.resumen || '')));
    const categoria = detectarCategoria(noticia.titulo + ' ' + (noticia.resumen || ''));
    const id = crypto.randomUUID();

    const timestamp = noticia.fechaPublicacion 
      ? new Date(noticia.fechaPublicacion).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    const sql = timestamp
      ? `INSERT INTO noticias (id, titulo, resumen, url, fuente, categoria, localidades, hash, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      : `INSERT INTO noticias (id, titulo, resumen, url, fuente, categoria, localidades, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = timestamp
      ? [id, noticia.titulo, noticia.resumen || '', noticia.url, noticia.fuente, categoria, localidades, hash, timestamp]
      : [id, noticia.titulo, noticia.resumen || '', noticia.url, noticia.fuente, categoria, localidades, hash];

    db.run(sql, params, function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          resolve({ duplicado: true });
        } else {
          reject(err);
        }
      } else {
        resolve({ id, nuevo: true, categoria });
      }
    });
  });
}

// Control de rate limit para notificaciones
let ultimaNotificacion = 0;
const DELAY_NOTIFICACIONES = 2000; // 2 segundos entre notificaciones

async function enviarNotificacion(noticia, categoria) {
  try {
    // Rate limiting: esperar si enviamos muy rápido
    const ahora = Date.now();
    const tiempoEspera = Math.max(0, DELAY_NOTIFICACIONES - (ahora - ultimaNotificacion));
    if (tiempoEspera > 0) {
      await new Promise(resolve => setTimeout(resolve, tiempoEspera));
    }
    
    const emojiCategoria = {
      turismo: '🏖️', politica: '🏛️', seguridad: '👮',
      deportes: '⚽', eventos: '🎪', ambiente: '🌿', general: '📰'
    };

    await axios.post('https://ntfy.sh', {
      topic: 'rocha-noticias',
      title: `${emojiCategoria[categoria] || '📰'} ${noticia.fuente}`,
      message: noticia.titulo,
      tags: [categoria],
      priority: 4,
      click: noticia.url
    }, { timeout: 5000 });
    
    ultimaNotificacion = Date.now();
    console.log(`🔔 Notificación: ${noticia.titulo.substring(0, 50)}...`);
  } catch (error) {
    if (error.response?.status === 429) {
      console.log('⏳ Rate limit alcanzado, notificación omitida');
    } else {
      console.error('⚠️ Error notificación:', error.message);
    }
  }
}

async function monitorearFuentes(fuentes, descripcion) {
  console.log(`\n🔍 ${descripcion}`);
  let noticiasNuevas = 0;
  let noticiasRevisadas = 0;

  for (const fuente of fuentes) {
    try {
      let noticias = [];
      
      if (fuente.tipo === 'rss') {
        noticias = await parsearRSS(fuente);
      } else if (fuente.tipo === 'facebook') {
        noticias = await scrapearFacebook(fuente);
      } else {
        noticias = await scrapearSitio(fuente);
      }

      noticiasRevisadas += noticias.length;

      for (const noticia of noticias) {
        try {
          const resultado = await guardarNoticia(noticia);
          if (resultado.nuevo) {
            noticiasNuevas++;
            console.log(`💾 NUEVA: ${noticia.titulo.substring(0, 70)}...`);
            await enviarNotificacion(noticia, resultado.categoria);
          }
        } catch (error) {
          // Silenciar errores de guardado
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));
    } catch (error) {
      console.error(`❌ Error ${fuente.nombre}: ${error.message}`);
    }
  }

  console.log(`📊 ${noticiasNuevas} nuevas de ${noticiasRevisadas} revisadas\n`);
  return noticiasNuevas;
}

// ===== CRON JOBS =====
cron.schedule('*/5 * * * *', async () => {
  console.log('\n⏰ MONITOREO PRIORITARIO (5 min)');
  await monitorearFuentes(FUENTES.filter(f => f.prioridad === 'muy-alta'), 'Muy prioritarias');
});

cron.schedule('*/15 * * * *', async () => {
  console.log('\n⏰ MONITOREO REGULAR (15 min)');
  await monitorearFuentes(FUENTES.filter(f => f.prioridad === 'alta'), 'Importantes');
});

cron.schedule('0 * * * *', async () => {
  console.log('\n⏰ MONITOREO SECUNDARIO (1 hora)');
  await monitorearFuentes(FUENTES.filter(f => f.prioridad === 'media'), 'Secundarias');
});

cron.schedule('0 3 * * *', () => {
  console.log('\n🧹 Limpieza diaria...');
  db.run('DELETE FROM noticias WHERE timestamp < datetime("now", "-30 days")', function(err) {
    if (!err) console.log(`✅ ${this.changes} noticias antiguas eliminadas`);
  });
});

// ===== API ENDPOINTS =====
app.get('/api/noticias', (req, res) => {
  const limite = parseInt(req.query.limite) || 50;
  const categoria = req.query.categoria;
  let sql = 'SELECT * FROM noticias';
  let params = [];
  
  if (categoria && categoria !== 'todas') {
    sql += ' WHERE categoria = ?';
    params.push(categoria);
  }
  
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limite);

  db.all(sql, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      rows.forEach(row => row.localidades = JSON.parse(row.localidades || '[]'));
      res.json({ noticias: rows, total: rows.length });
    }
  });
});

app.get('/api/noticias/:id', (req, res) => {
  db.get('SELECT * FROM noticias WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (!row) {
      res.status(404).json({ error: 'Noticia no encontrada' });
    } else {
      row.localidades = JSON.parse(row.localidades || '[]');
      res.json(row);
    }
  });
});

app.get('/api/buscar', (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Parámetro q requerido' });

  const sql = `SELECT * FROM noticias WHERE titulo LIKE ? OR resumen LIKE ? ORDER BY timestamp DESC LIMIT 50`;
  const searchTerm = `%${query}%`;

  db.all(sql, [searchTerm, searchTerm], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      rows.forEach(row => row.localidades = JSON.parse(row.localidades || '[]'));
      res.json({ resultados: rows, total: rows.length });
    }
  });
});

app.get('/api/stats', (req, res) => {
  const stats = {};
  db.get('SELECT COUNT(*) as count FROM noticias', (err, row) => {
    stats.total = row.count;
    db.get('SELECT COUNT(*) as count FROM noticias WHERE DATE(timestamp) = DATE("now")', (err, row) => {
      stats.hoy = row.count;
      db.all('SELECT categoria, COUNT(*) as count FROM noticias GROUP BY categoria ORDER BY count DESC', (err, rows) => {
        stats.categorias = rows;
        db.all('SELECT fuente, COUNT(*) as count FROM noticias GROUP BY fuente ORDER BY count DESC LIMIT 10', (err, rows) => {
          stats.fuentes = rows;
          res.json(stats);
        });
      });
    });
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    fuentes_activas: FUENTES.length
  });
});

app.get('/', (req, res) => {
  res.json({
    nombre: 'API Noticias Rocha',
    version: '3.0.0',
    fuentes: FUENTES.length,
    endpoints: [
      'GET /api/noticias',
      'GET /api/noticias/:id',
      'GET /api/buscar?q=texto',
      'GET /api/stats',
      'GET /health'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  🌊 Noticias de Rocha - 100% GRATIS                  ║
║  🚀 Puerto ${PORT}                                        ║
║  📡 ${FUENTES.length} fuentes activas                            ║
║  🔔 Notificaciones: ntfy.sh/rocha-noticias           ║
╚═══════════════════════════════════════════════════════╝
  `);
  
  setTimeout(() => monitorearFuentes(FUENTES, 'Monitoreo inicial'), 5000);
});

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando...');
  db.close(() => process.exit(0));
});
