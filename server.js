// server.js - Backend CORREGIDO con Twitter/X y Facebook
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
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});
const PORT = process.env.PORT || 3000;

// Variables de entorno opcionales
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || null;
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || null;

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
    imagenUrl TEXT,
    autor TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS dispositivos (
    token TEXT PRIMARY KEY,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON noticias(timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_categoria ON noticias(categoria)`);
});

const KEYWORDS = {
  principal: ['rocha', 'departamento de rocha'],
  localidades: [
    'la paloma', 'la pedrera', 'barra de valizas', 'punta del diablo',
    'aguas dulces', 'chuy', 'castillos', 'lascano', 'cebollatí',
    '19 de abril', 'la coronilla', 'cabo polonio', 'valizas', 'la esmeralda',
    'santa isabel de la pedrera', 'océano azul', 'la aguada'
  ],
  categorias: {
    turismo: ['turismo', 'playa', 'temporada', 'guardavidas', 'aeropuerto', 'hotel', 'visitantes', 'balneario'],
    politica: ['intendencia', 'municipio', 'intendente', 'alcalde', 'junta', 'edil', 'gobierno'],
    seguridad: ['policía', 'bomberos', 'siniestro', 'accidente', 'rapiña', 'hurto', 'rescate', 'emergencia'],
    deportes: ['rocha fc', 'fútbol', 'deporte', 'campeonato', 'torneo', 'liga'],
    eventos: ['festival', 'evento', 'feria', 'concierto', 'espectáculo', 'carnaval'],
    ambiente: ['medio ambiente', 'contaminación', 'playa', 'ecosistema', 'naturaleza', 'fauna']
  }
};

const FUENTES = [
  // ===== FUENTES LOCALES PRIORITARIAS =====
  {
    nombre: 'Rocha Noticias',
    url: 'https://rochanoticias.com',
    tipo: 'scraping',
    selector: '.post-title a, .entry-title a, article h2 a, h2.title a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Rocha al Día',
    url: 'https://rochaaldia.com',
    tipo: 'scraping',
    selector: '.post-title a, .entry-title a, h2 a, article header a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Rocha Total',
    url: 'https://rochatotal.com',
    tipo: 'scraping',
    selector: '.entry-title a, h2.title a, article h2 a',
    prioridad: 'alta'
  },

  // ===== MEDIOS NACIONALES =====
  {
    nombre: 'El Observador',
    url: 'https://www.elobservador.com.uy/tags/rocha',
    tipo: 'scraping',
    selector: '.article-title a, h2 a, .headline a, .story-title a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Montevideo Portal',
    url: 'https://www.montevideo.com.uy/Noticias/Rocha',
    tipo: 'scraping',
    selector: '.article-title a, h2.title a, .headline a, .listanoticias a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'La Diaria',
    url: 'https://ladiaria.com.uy/articulo/tag/rocha/',
    tipo: 'scraping',
    selector: 'article h2 a, .article-title a, h3 a',
    prioridad: 'alta'
  },

  // ===== GOOGLE NEWS RSS (siempre funcionan) =====
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
    prioridad: 'alta'
  },
  {
    nombre: 'Google News - Chuy',
    url: 'https://news.google.com/rss/search?q=Chuy+Uruguay+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'alta'
  },
  {
    nombre: 'Google News - Cabo Polonio',
    url: 'https://news.google.com/rss/search?q=%22Cabo+Polonio%22+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'media'
  },
  {
    nombre: 'Google News - Barra de Valizas',
    url: 'https://news.google.com/rss/search?q=%22Barra+de+Valizas%22+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'media'
  },

  // ===== FUENTES OFICIALES =====
  {
    nombre: 'Intendencia de Rocha',
    url: 'https://rocha.gub.uy',
    tipo: 'scraping',
    selector: '.noticia-titulo a, article h2 a, .news-title a, .titulo-noticia a',
    prioridad: 'media'
  },
  {
    nombre: 'Turismo Rocha',
    url: 'https://www.turismorocha.gub.uy',
    tipo: 'scraping',
    selector: '.news-title a, article h2 a, .noticia a',
    prioridad: 'media'
  },

  // ===== TWITTER/X via RapidAPI (si tienes API key) =====
  {
    nombre: 'Twitter - Rocha',
    url: 'twitter-search',
    tipo: 'twitter-api',
    query: 'Rocha Uruguay -filter:retweets',
    prioridad: 'alta',
    activo: !!TWITTER_BEARER_TOKEN
  },
  {
    nombre: 'Twitter - La Paloma',
    url: 'twitter-search',
    tipo: 'twitter-api',
    query: '"La Paloma" Rocha -filter:retweets',
    prioridad: 'media',
    activo: !!TWITTER_BEARER_TOKEN
  },

  // ===== FACEBOOK (vía scraping público) =====
  {
    nombre: 'Facebook - Rocha Noticias',
    url: 'https://m.facebook.com/rochanoticias',
    tipo: 'facebook',
    prioridad: 'alta'
  },
  {
    nombre: 'Facebook - Intendencia Rocha',
    url: 'https://m.facebook.com/IntendenciadeRocha',
    tipo: 'facebook',
    prioridad: 'media'
  }
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
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
    if (textoLower.includes(loc)) {
      localidadesEncontradas.push(loc);
    }
  });
  return localidadesEncontradas;
}

function detectarCategoria(texto) {
  const textoLower = texto.toLowerCase();
  for (const [categoria, keywords] of Object.entries(KEYWORDS.categorias)) {
    for (const keyword of keywords) {
      if (textoLower.includes(keyword)) {
        return categoria;
      }
    }
  }
  return 'general';
}

function contieneKeywords(texto) {
  const textoLower = texto.toLowerCase();
  const tienePrincipal = KEYWORDS.principal.some(kw => textoLower.includes(kw));
  const tieneLocalidad = KEYWORDS.localidades.some(loc => textoLower.includes(loc));
  return tienePrincipal || tieneLocalidad;
}

function esNoticiaReciente(fechaStr) {
  if (!fechaStr) return true;
  try {
    const fechaNoticia = new Date(fechaStr);
    const ahora = new Date();
    const diasDiferencia = (ahora - fechaNoticia) / (1000 * 60 * 60 * 24);
    return diasDiferencia <= 7;
  } catch (error) {
    return true;
  }
}

function limpiarTexto(texto) {
  if (!texto) return texto;
  texto = texto.replace(/https?:\/\/[^\s]+/g, '');
  texto = texto.replace(/^RT\s+/i, '');
  texto = texto.replace(/\s+/g, ' ').trim();
  return texto;
}

// ===== SCRAPING MEJORADO CON ANTI-DETECCIÓN =====
async function scrapearSitio(fuente) {
  try {
    console.log(`📡 Scrapeando: ${fuente.nombre}`);
    
    const headers = {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    };

    const response = await axios.get(fuente.url, {
      headers,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    if (response.status === 403 || response.status === 404) {
      console.log(`⚠️ ${fuente.nombre}: Acceso bloqueado (${response.status})`);
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

    console.log(`✅ ${fuente.nombre}: ${noticias.length} noticias relevantes`);
    return noticias;
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      console.error(`❌ ${fuente.nombre}: Sitio no encontrado`);
    } else {
      console.error(`❌ Error en ${fuente.nombre}:`, error.message);
    }
    return [];
  }
}

// ===== RSS PARSER =====
async function parsearRSS(fuente) {
  try {
    console.log(`📡 RSS: ${fuente.nombre}`);
    const feed = await parser.parseURL(fuente.url);
    const noticias = [];
    const visitedUrls = new Set();

    feed.items.forEach((item, i) => {
      if (i >= 30) return;
      const titulo = item.title || '';
      const resumen = item.contentSnippet || item.description || item.content || '';
      const textoCompleto = `${titulo} ${resumen}`;
      const url = item.link || item.guid;
      const fecha = item.pubDate || item.isoDate || item.date;
      
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

    console.log(`✅ ${fuente.nombre}: ${noticias.length} noticias relevantes`);
    return noticias;
  } catch (error) {
    console.error(`❌ Error en RSS ${fuente.nombre}:`, error.message);
    return [];
  }
}

// ===== TWITTER API (OPCIONAL) =====
async function buscarEnTwitter(fuente) {
  if (!TWITTER_BEARER_TOKEN || !fuente.activo) return [];
  
  try {
    console.log(`🐦 Twitter: ${fuente.query}`);
    
    const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
      headers: {
        'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`
      },
      params: {
        query: fuente.query,
        max_results: 20,
        'tweet.fields': 'created_at,author_id,public_metrics',
        'user.fields': 'username,name'
      },
      timeout: 10000
    });

    const noticias = [];
    if (response.data.data) {
      response.data.data.forEach(tweet => {
        if (contieneKeywords(tweet.text)) {
          noticias.push({
            titulo: limpiarTexto(tweet.text).substring(0, 200),
            url: `https://twitter.com/i/web/status/${tweet.id}`,
            fuente: fuente.nombre,
            fechaPublicacion: tweet.created_at
          });
        }
      });
    }

    console.log(`✅ ${fuente.nombre}: ${noticias.length} tweets relevantes`);
    return noticias;
  } catch (error) {
    console.error(`❌ Error en Twitter ${fuente.nombre}:`, error.message);
    return [];
  }
}

// ===== FACEBOOK SCRAPING =====
async function scrapearFacebook(fuente) {
  try {
    console.log(`📘 Facebook: ${fuente.nombre}`);
    
    const response = await axios.get(fuente.url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-UY,es;q=0.9'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const noticias = [];
    const visitedUrls = new Set();

    // Facebook mobile tiene una estructura específica
    $('article, div[data-ft]').each((i, elem) => {
      if (i >= 20) return false;
      
      const texto = $(elem).text().trim();
      const linkElem = $(elem).find('a[href*="/posts/"], a[href*="/story.php"]').first();
      
      if (!linkElem.length || !texto) return;
      
      let url = linkElem.attr('href');
      if (url.startsWith('/')) {
        url = 'https://m.facebook.com' + url;
      }
      
      if (visitedUrls.has(url)) return;
      visitedUrls.add(url);
      
      if (contieneKeywords(texto)) {
        noticias.push({
          titulo: texto.substring(0, 200),
          url: url.split('?')[0], // Limpiar parámetros
          fuente: fuente.nombre
        });
      }
    });

    console.log(`✅ ${fuente.nombre}: ${noticias.length} posts relevantes`);
    return noticias;
  } catch (error) {
    console.error(`❌ Error en Facebook ${fuente.nombre}:`, error.message);
    return [];
  }
}

// ===== GUARDADO EN BASE DE DATOS =====
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

// ===== NOTIFICACIONES PUSH =====
async function enviarNotificacion(noticia, categoria) {
  try {
    const emojiCategoria = {
      turismo: '🏖️',
      politica: '🏛️',
      seguridad: '👮',
      deportes: '⚽',
      eventos: '🎪',
      ambiente: '🌿',
      general: '📰'
    };

    const mensaje = {
      topic: 'rocha-noticias',
      title: `${emojiCategoria[categoria] || '📰'} ${noticia.fuente}`,
      message: noticia.titulo,
      tags: [categoria],
      priority: 4,
      click: noticia.url
    };

    await axios.post('https://ntfy.sh', mensaje, { timeout: 5000 });
    console.log(`🔔 Notificación enviada: ${noticia.titulo.substring(0, 50)}...`);
  } catch (error) {
    console.error('⚠️ Error al enviar notificación:', error.message);
  }
}

// ===== MONITOREO DE FUENTES =====
async function monitorearFuentesEspecificas(fuentes, descripcion) {
  console.log(`\n🔍 ${descripcion}`);
  let noticiasNuevas = 0;
  let noticiasRevisadas = 0;

  for (const fuente of fuentes) {
    try {
      let noticias = [];
      
      if (fuente.tipo === 'rss') {
        noticias = await parsearRSS(fuente);
      } else if (fuente.tipo === 'twitter-api') {
        noticias = await buscarEnTwitter(fuente);
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
          // Error guardando
        }
      }

      // Delay aleatorio entre fuentes
      const delay = 2000 + Math.random() * 3000;
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error) {
      console.error(`❌ Error procesando ${fuente.nombre}:`, error.message);
    }
  }

  console.log(`📊 Resultado: ${noticiasNuevas} nuevas de ${noticiasRevisadas} revisadas\n`);
  return noticiasNuevas;
}

// ===== CRON JOBS =====
cron.schedule('*/5 * * * *', async () => {
  console.log('\n⏰ ═══ MONITOREO PRIORITARIO (cada 5 min) ═══');
  const fuentesPrioritarias = FUENTES.filter(f => f.prioridad === 'muy-alta');
  await monitorearFuentesEspecificas(fuentesPrioritarias, 'Fuentes muy prioritarias');
});

cron.schedule('*/15 * * * *', async () => {
  console.log('\n⏰ ═══ MONITOREO REGULAR (cada 15 min) ═══');
  const fuentesAltas = FUENTES.filter(f => f.prioridad === 'alta');
  await monitorearFuentesEspecificas(fuentesAltas, 'Fuentes importantes');
});

cron.schedule('0 * * * *', async () => {
  console.log('\n⏰ ═══ MONITOREO OFICIAL (cada hora) ═══');
  const fuentesMedias = FUENTES.filter(f => f.prioridad === 'media');
  await monitorearFuentesEspecificas(fuentesMedias, 'Fuentes oficiales y secundarias');
});

cron.schedule('0 3 * * *', () => {
  console.log('\n🧹 Limpieza diaria de noticias antiguas...');
  db.run('DELETE FROM noticias WHERE timestamp < datetime("now", "-30 days")', function(err) {
    if (err) {
      console.error('❌ Error en limpieza:', err);
    } else {
      console.log(`✅ Limpieza completada: ${this.changes} noticias eliminadas`);
    }
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
      rows.forEach(row => {
        row.localidades = JSON.parse(row.localidades || '[]');
      });
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
  if (!query) {
    return res.status(400).json({ error: 'Parámetro q requerido' });
  }

  const sql = `SELECT * FROM noticias WHERE titulo LIKE ? OR resumen LIKE ? ORDER BY timestamp DESC LIMIT 50`;
  const searchTerm = `%${query}%`;

  db.all(sql, [searchTerm, searchTerm], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      rows.forEach(row => {
        row.localidades = JSON.parse(row.localidades || '[]');
      });
      res.json({ resultados: rows, total: rows.length });
    }
  });
});

app.post('/api/registro-dispositivo', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token requerido' });
  }

  db.run('INSERT OR REPLACE INTO dispositivos (token) VALUES (?)', [token], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true, mensaje: 'Dispositivo registrado', topic: 'rocha-noticias' });
    }
  });
});

app.get('/api/stats', (req, res) => {
  const queries = {
    total: 'SELECT COUNT(*) as count FROM noticias',
    hoy: 'SELECT COUNT(*) as count FROM noticias WHERE DATE(timestamp) = DATE("now")',
    semana: 'SELECT COUNT(*) as count FROM noticias WHERE timestamp > datetime("now", "-7 days")',
    porCategoria: 'SELECT categoria, COUNT(*) as count FROM noticias GROUP BY categoria ORDER BY count DESC',
    porFuente: 'SELECT fuente, COUNT(*) as count FROM noticias GROUP BY fuente ORDER BY count DESC LIMIT 10',
    recientes: 'SELECT COUNT(*) as count FROM noticias WHERE timestamp > datetime("now", "-1 hour")'
  };

  const stats = {};

  db.get(queries.total, (err, row) => {
    stats.total = row.count;
    db.get(queries.hoy, (err, row) => {
      stats.hoy = row.count;
      db.get(queries.semana, (err, row) => {
        stats.semana = row.count;
        db.get(queries.recientes, (err, row) => {
          stats.ultima_hora = row.count;
          db.all(queries.porCategoria, (err, rows) => {
            stats.categorias = rows;
            db.all(queries.porFuente, (err, rows) => {
              stats.fuentes = rows;
              res.json(stats);
            });
          });
        });
      });
    });
  });
});

app.get('/api/admin/limpiar', (req, res) => {
  console.log('🧹 Limpieza manual solicitada...');
  db.run('DELETE FROM noticias WHERE timestamp < datetime("now", "-7 days")', function(err) {
    if (err) {
      console.error('❌ Error en limpieza:', err);
      res.status(500).json({ error: err.message });
    } else {
      console.log(`✅ Eliminadas ${this.changes} noticias antiguas`);
      res.json({ success: true, eliminadas: this.changes, mensaje: `Se eliminaron ${this.changes} noticias de más de 7 días` });
    }
  });
});

app.get('/api/admin/fechas', (req, res) => {
  const sql = `SELECT DATE(timestamp) as fecha, COUNT(*) as cantidad FROM noticias GROUP BY DATE(timestamp) ORDER BY fecha DESC LIMIT 30`;
  db.all(sql, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ distribucion: rows, total: rows.reduce((sum, row) => sum + row.cantidad, 0) });
    }
  });
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), fuentes_activas: FUENTES.length });
});

app.get('/', (req, res) => {
  res.json({
    nombre: 'API de Noticias de Rocha - MEJORADA',
    version: '2.0.0',
    fuentes: FUENTES.length,
    descripcion: 'Sistema automatizado de monitoreo de noticias del Departamento de Rocha, Uruguay',
    endpoints: [
      'GET /api/noticias',
      'GET /api/noticias?categoria=turismo',
      'GET /api/noticias/:id',
      'GET /api/buscar?q=texto',
      'POST /api/registro-dispositivo',
      'GET /api/stats',
      'GET /health'
    ],
    categorias: Object.keys(KEYWORDS.categorias),
    localidades_monitoreadas: KEYWORDS.localidades.length
  });
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  🌊 Sistema de Monitoreo de Noticias de Rocha - MEJORADO    ║
║  🚀 Servidor iniciado en puerto ${PORT}                           ║
║  📡 Monitoreando ${FUENTES.length} fuentes de noticias                    ║
║  🔔 Notificaciones: ntfy.sh/rocha-noticias                   ║
║  ⏰ Actualizaciones: cada 3-30 minutos según prioridad       ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  console.log('🔄 Ejecutando monitoreo inicial en 5 segundos...');
  setTimeout(async () => {
    await monitorearFuentesEspecificas(FUENTES, 'Monitoreo inicial de todas las fuentes');
  }, 5000);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Promesa rechazada:', reason);
});

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando servidor...');
  db.close((err) => {
    if (err) console.error('Error cerrando BD:', err);
    process.exit(0);
  });
});
