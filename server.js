// server.js - Backend COMPLETO para monitoreo de noticias de Rocha
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
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
    '19 de abril', 'la coronilla', 'cabo polonio', 'valizas', 'la esmeralda'
  ],
  categorias: {
    turismo: ['turismo', 'playa', 'temporada', 'guardavidas', 'aeropuerto', 'hotel', 'visitantes'],
    politica: ['intendencia', 'municipio', 'intendente', 'alcalde', 'junta', 'edil'],
    seguridad: ['policía', 'bomberos', 'siniestro', 'accidente', 'rapiña', 'hurto', 'rescate'],
    deportes: ['rocha fc', 'fútbol', 'deporte', 'campeonato', 'torneo'],
    eventos: ['festival', 'evento', 'feria', 'concierto', 'espectáculo']
  }
};

const FUENTES = [
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
    nombre: 'La Paloma Hoy',
    url: 'https://lapalomahoy.com',
    tipo: 'scraping',
    selector: '.post-title a, article h2 a, .entry-title a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Rocha Total',
    url: 'https://rochatotal.com',
    tipo: 'scraping',
    selector: '.entry-title a, h2.title a, article h2 a',
    prioridad: 'alta'
  },
  {
    nombre: 'El País - Rocha',
    url: 'https://www.elpais.com.uy/noticias/rocha',
    tipo: 'scraping',
    selector: 'article h2 a, .headline a, .article-title a, h3 a',
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
    nombre: 'Subrayado',
    url: 'https://www.subrayado.com.uy/sitio/busqueda?texto=rocha',
    tipo: 'scraping',
    selector: '.article-title a, h2 a, .titulo a',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'El Observador - Rocha',
    url: 'https://www.elobservador.com.uy/buscar?q=Rocha',
    tipo: 'scraping',
    selector: '.article-title a, h2 a, .headline a',
    prioridad: 'alta'
  },
  {
    nombre: 'La Diaria',
    url: 'https://ladiaria.com.uy/search/?q=rocha',
    tipo: 'scraping',
    selector: 'article h2 a, .article-title a, h3 a',
    prioridad: 'alta'
  },
  {
    nombre: 'Telemundo',
    url: 'https://www.telemundo.com.uy',
    tipo: 'scraping',
    selector: 'article h2 a, .entry-title a, .post-title a',
    prioridad: 'media'
  },
  {
    nombre: 'Google News - Rocha Hoy',
    url: 'https://news.google.com/rss/search?q=Rocha+Uruguay+when:1d&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'muy-alta'
  },
  {
    nombre: 'Google News - La Paloma Hoy',
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
  },{
    nombre: 'X - Rocha Uruguay',
    url: 'https://nitter.net/search/rss?f=tweets&q=Rocha+Uruguay+-filter:retweets+-filter:replies',
    tipo: 'rss',
    prioridad: 'alta'
  },
  {
    nombre: 'X - Hashtag #Rocha',
    url: 'https://nitter.net/search/rss?f=tweets&q=%23Rocha+%23Uruguay+-filter:retweets',
    tipo: 'rss',
    prioridad: 'alta'
  },
  {
    nombre: 'X - La Paloma',
    url: 'https://nitter.net/search/rss?f=tweets&q=%22La+Paloma%22+Rocha+-filter:retweets',
    tipo: 'rss',
    prioridad: 'media'
  },
  {
    nombre: 'X - Punta del Diablo',
    url: 'https://nitter.net/search/rss?f=tweets&q=%22Punta+del+Diablo%22+-filter:retweets',
    tipo: 'rss',
    prioridad: 'media'
  },
  {
    nombre: 'X - Cabo Polonio',
    url: 'https://nitter.net/search/rss?f=tweets&q=%22Cabo+Polonio%22+-filter:retweets',
    tipo: 'rss',
    prioridad: 'media'
  }

// NOTA: Si conoces cuentas oficiales específicas de Twitter, puedes agregarlas así:
// {
//   nombre: 'X - @GobiernoRocha',
//   url: 'https://nitter.net/GobiernoRocha/rss',
//   tipo: 'rss',
//   prioridad: 'alta'
// }

// ========== IMPORTANTE: AGREGAR LIMPIEZA DE TEXTO DE TWEETS ==========
// Los tweets tienen URLs, menciones y hashtags que queremos limpiar
// Busca la función "parsearRSS" y ANTES de ella, agrega esta función:

function limpiarTextoTweet(texto) {
  if (!texto) return texto;
  
  // Eliminar URLs (http, https)
  texto = texto.replace(/https?:\/\/[^\s]+/g, '');
  
  // Eliminar menciones @usuario (pero dejar el primer @)
  const menciones = texto.match(/@\w+/g);
  if (menciones && menciones.length > 1) {
    // Mantener solo la primera mención
    for (let i = 1; i < menciones.length; i++) {
      texto = texto.replace(menciones[i], '');
    }
  }
  
  // Eliminar exceso de hashtags al final (más de 3 seguidos)
  texto = texto.replace(/(\s#\w+){4,}$/g, '');
  
  // Eliminar espacios múltiples
  texto = texto.replace(/\s+/g, ' ').trim();
  
  // Eliminar caracteres especiales de Twitter como RT, via, etc
  texto = texto.replace(/^RT\s+/i, '');
  
  return texto;
}
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
async function scrapearSitio(fuente) {
  try {
    console.log(`📡 Scrapeando: ${fuente.nombre}`);
    const response = await axios.get(fuente.url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000,
      maxRedirects: 5
    });

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
    console.error(`❌ Error en ${fuente.nombre}:`, error.message);
    return [];
  }
}
function limpiarTextoTweet(texto) {
  if (!texto) return texto;
  
  // Eliminar URLs (http, https)
  texto = texto.replace(/https?:\/\/[^\s]+/g, '');
  
  // Eliminar menciones @usuario (pero dejar el primer @)
  const menciones = texto.match(/@\w+/g);
  if (menciones && menciones.length > 1) {
    // Mantener solo la primera mención
    for (let i = 1; i < menciones.length; i++) {
      texto = texto.replace(menciones[i], '');
    }
  }
  
  // Eliminar exceso de hashtags al final (más de 3 seguidos)
  texto = texto.replace(/(\s#\w+){4,}$/g, '');
  
  // Eliminar espacios múltiples
  texto = texto.replace(/\s+/g, ' ').trim();
  
  // Eliminar caracteres especiales de Twitter como RT, via, etc
  texto = texto.replace(/^RT\s+/i, '');
  
  return texto;
}
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
      
      // ✅ NUEVO: Verificar que sea noticia reciente
      if (!esNoticiaReciente(fecha)) {
        console.log(`⏭️ Saltando noticia antigua: ${titulo.substring(0, 50)}...`);
        return;
      }
      
      if (contieneKeywords(textoCompleto)) {
        noticias.push({
           titulo: limpiarTextoTweet(titulo).substring(0, 200),
          url,
          resumen: limpiarTextoTweet(resumen).substring(0, 400),
          fuente: fuente.nombre,
          fechaPublicacion: fecha
        });
      }
    });

    console.log(`✅ ${fuente.nombre}: ${noticias.length} noticias relevantes (últimos 7 días)`);
    return noticias;
  } catch (error) {
    console.error(`❌ Error en RSS ${fuente.nombre}:`, error.message);
    return [];
  }
}

function guardarNoticia(noticia) {
  return new Promise((resolve, reject) => {
    const hash = generarHash(noticia.titulo);
    const localidades = JSON.stringify(detectarLocalidades(noticia.titulo + ' ' + (noticia.resumen || '')));
    const categoria = detectarCategoria(noticia.titulo + ' ' + (noticia.resumen || ''));
    const id = crypto.randomUUID();

    // Si la noticia tiene fecha de publicación, usarla; si no, usar fecha actual
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

async function enviarNotificacion(noticia, categoria) {
  try {
    const emojiCategoria = {
      turismo: '🏖️',
      politica: '🏛️',
      seguridad: '👮',
      deportes: '⚽',
      eventos: '🎪',
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

async function monitorearFuentesEspecificas(fuentes, descripcion) {
  console.log(`\n🔍 ${descripcion}`);
  let noticiasNuevas = 0;
  let noticiasRevisadas = 0;

  for (const fuente of fuentes) {
    try {
      let noticias = [];
      if (fuente.tipo === 'rss') {
        noticias = await parsearRSS(fuente);
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

      const delay = 2000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error) {
      console.error(`❌ Error procesando ${fuente.nombre}:`, error.message);
    }
  }

  console.log(`📊 Resultado: ${noticiasNuevas} nuevas de ${noticiasRevisadas} revisadas\n`);
  return noticiasNuevas;
}

cron.schedule('*/3 * * * *', async () => {
  console.log('\n⏰ ═══ MONITOREO PRIORITARIO (cada 3 min) ═══');
  const fuentesPrioritarias = FUENTES.filter(f => f.prioridad === 'muy-alta');
  await monitorearFuentesEspecificas(fuentesPrioritarias, 'Fuentes muy prioritarias');
});

cron.schedule('*/10 * * * *', async () => {
  console.log('\n⏰ ═══ MONITOREO REGULAR (cada 10 min) ═══');
  const fuentesAltas = FUENTES.filter(f => f.prioridad === 'alta');
  await monitorearFuentesEspecificas(fuentesAltas, 'Fuentes importantes');
});

cron.schedule('*/30 * * * *', async () => {
  console.log('\n⏰ ═══ MONITOREO OFICIAL (cada 30 min) ═══');
  const fuentesMedias = FUENTES.filter(f => f.prioridad === 'media');
  await monitorearFuentesEspecificas(fuentesMedias, 'Fuentes oficiales');
});

cron.schedule('0 3 * * *', () => {
  console.log('\n🧹 Ejecutando limpieza diaria...');
  db.run('DELETE FROM noticias WHERE timestamp < datetime("now", "-60 days")', function(err) {
    if (err) {
      console.error('❌ Error en limpieza:', err);
    } else {
      console.log(`✅ Limpieza completada: ${this.changes} noticias antiguas eliminadas`);
    }
  });
});
// Cada hora: Limpiar noticias de más de 30 días
cron.schedule('0 * * * *', () => {
  console.log('\n🧹 Limpieza automática cada hora...');
  db.run('DELETE FROM noticias WHERE timestamp < datetime("now", "-30 days")', function(err) {
    if (err) {
      console.error('❌ Error en limpieza:', err);
    } else if (this.changes > 0) {
      console.log(`✅ Eliminadas ${this.changes} noticias antiguas (>30 días)`);
    }
  });
});

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
// Endpoint para limpiar noticias antiguas manualmente
app.get('/api/admin/limpiar', (req, res) => {
  console.log('🧹 Limpieza manual solicitada...');
  
  db.run('DELETE FROM noticias WHERE timestamp < datetime("now", "-7 days")', function(err) {
    if (err) {
      console.error('❌ Error en limpieza:', err);
      res.status(500).json({ error: err.message });
    } else {
      console.log(`✅ Eliminadas ${this.changes} noticias antiguas`);
      res.json({ 
        success: true, 
        eliminadas: this.changes,
        mensaje: `Se eliminaron ${this.changes} noticias de más de 7 días`
      });
    }
  });
});

// Endpoint para ver distribución de noticias por fecha
app.get('/api/admin/fechas', (req, res) => {
  const sql = `
    SELECT 
      DATE(timestamp) as fecha,
      COUNT(*) as cantidad
    FROM noticias 
    GROUP BY DATE(timestamp)
    ORDER BY fecha DESC
    LIMIT 30
  `;
  
  db.all(sql, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ 
        distribucion: rows,
        total: rows.reduce((sum, row) => sum + row.cantidad, 0)
      });
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
