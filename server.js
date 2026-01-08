// server.js - Backend para monitoreo de noticias de Rocha
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
const parser = new Parser();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Base de datos SQLite
const db = new sqlite3.Database('./noticias.db', (err) => {
  if (err) console.error('Error al abrir base de datos:', err);
  else console.log('✅ Base de datos conectada');
});

// Crear tablas
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

// Palabras clave
const KEYWORDS = {
  principal: ['rocha', 'departamento de rocha'],
  localidades: [
    'la paloma', 'la pedrera', 'barra de valizas', 'punta del diablo',
    'aguas dulces', 'chuy', 'castillos', 'lascano', 'cebollatí',
    '19 de abril', 'la coronilla', 'cabo polonio'
  ],
  categorias: {
    turismo: ['turismo', 'playa', 'temporada', 'guardavidas', 'aeropuerto'],
    politica: ['intendencia', 'municipio', 'intendente', 'alcalde'],
    seguridad: ['policía', 'bomberos', 'siniestro', 'accidente'],
    deportes: ['rocha fc', 'fútbol', 'deporte'],
    eventos: ['festival', 'evento', 'feria']
  }
};

// Fuentes de noticias
const FUENTES = [
  {
    nombre: 'Rocha Noticias',
    url: 'https://rochanoticias.com',
    tipo: 'scraping',
    selector: '.post-title a, .entry-title a, h2 a',
    prioridad: 'alta'
  },
  {
    nombre: 'El País - Rocha',
    url: 'https://www.elpais.com.uy/noticias/rocha',
    tipo: 'scraping',
    selector: 'article h2 a, .headline a',
    prioridad: 'alta'
  },
  {
    nombre: 'Montevideo Portal',
    url: 'https://www.montevideo.com.uy',
    tipo: 'scraping',
    selector: '.article-title a, h2.title a',
    prioridad: 'alta'
  },
  {
    nombre: 'Google News - Rocha',
    url: 'https://news.google.com/rss/search?q=Rocha+Uruguay&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'alta'
  },
  {
    nombre: 'Google News - La Paloma',
    url: 'https://news.google.com/rss/search?q=La+Paloma+Rocha&hl=es-UY&gl=UY&ceid=UY:es-419',
    tipo: 'rss',
    prioridad: 'media'
  }
];

// Funciones de utilidad
function generarHash(texto) {
  return crypto.createHash('md5').update(texto.toLowerCase()).digest('hex');
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
  
  // Buscar palabra principal
  const tienePrincipal = KEYWORDS.principal.some(kw => textoLower.includes(kw));
  
  // Buscar localidades
  const tieneLocalidad = KEYWORDS.localidades.some(loc => textoLower.includes(loc));
  
  return tienePrincipal || tieneLocalidad;
}

// Scraper genérico
async function scrapearSitio(fuente) {
  try {
    console.log(`📡 Scrapeando: ${fuente.nombre}`);
    
    const response = await axios.get(fuente.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const noticias = [];

    $(fuente.selector).each((i, elem) => {
      if (i >= 20) return; // Límite de 20 noticias por fuente
      
      const titulo = $(elem).text().trim();
      let url = $(elem).attr('href');
      
      if (!url) return;
      
      // Convertir URL relativa a absoluta
      if (url.startsWith('/')) {
        const baseUrl = new URL(fuente.url);
        url = `${baseUrl.protocol}//${baseUrl.host}${url}`;
      }
      
      if (!url.startsWith('http')) return;
      
      // Filtrar por keywords
      if (contieneKeywords(titulo)) {
        noticias.push({
          titulo,
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

// Parser RSS
async function parsearRSS(fuente) {
  try {
    console.log(`📡 RSS: ${fuente.nombre}`);
    
    const feed = await parser.parseURL(fuente.url);
    const noticias = [];

    feed.items.forEach((item, i) => {
      if (i >= 20) return;
      
      const titulo = item.title || '';
      const resumen = item.contentSnippet || item.description || '';
      const textoCompleto = `${titulo} ${resumen}`;
      
      if (contieneKeywords(textoCompleto)) {
        noticias.push({
          titulo,
          url: item.link,
          resumen: resumen.substring(0, 400),
          fuente: fuente.nombre
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

// Guardar noticia en DB
function guardarNoticia(noticia) {
  return new Promise((resolve, reject) => {
    const hash = generarHash(noticia.titulo);
    const localidades = JSON.stringify(detectarLocalidades(noticia.titulo + ' ' + (noticia.resumen || '')));
    const categoria = detectarCategoria(noticia.titulo + ' ' + (noticia.resumen || ''));
    const id = crypto.randomUUID();

    const sql = `INSERT INTO noticias (id, titulo, resumen, url, fuente, categoria, localidades, hash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
      id,
      noticia.titulo,
      noticia.resumen || '',
      noticia.url,
      noticia.fuente,
      categoria,
      localidades,
      hash
    ], function(err) {
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

// Enviar notificación push (ntfy.sh)
async function enviarNotificacion(noticia, categoria) {
  try {
    // Obtener todos los dispositivos registrados
    db.all('SELECT token FROM dispositivos', async (err, rows) => {
      if (err || !rows.length) return;

      const mensaje = {
        topic: 'rocha-noticias', // Tema público para ntfy.sh
        title: `📰 ${noticia.fuente}`,
        message: noticia.titulo,
        tags: [categoria],
        priority: 4,
        click: noticia.url
      };

      try {
        await axios.post('https://ntfy.sh', mensaje);
        console.log('🔔 Notificación enviada');
      } catch (error) {
        console.error('Error al enviar notificación:', error.message);
      }
    });
  } catch (error) {
    console.error('Error en enviarNotificacion:', error);
  }
}

// Proceso principal de monitoreo
async function monitorearFuentes() {
  console.log('\n🔍 Iniciando monitoreo...');
  let noticiasNuevas = 0;

  for (const fuente of FUENTES) {
    try {
      let noticias = [];
      
      if (fuente.tipo === 'rss') {
        noticias = await parsearRSS(fuente);
      } else {
        noticias = await scrapearSitio(fuente);
      }

      for (const noticia of noticias) {
        try {
          const resultado = await guardarNoticia(noticia);
          
          if (resultado.nuevo) {
            noticiasNuevas++;
            console.log(`💾 Nueva: ${noticia.titulo.substring(0, 60)}...`);
            
            // Enviar notificación push
            await enviarNotificacion(noticia, resultado.categoria);
          }
        } catch (error) {
          console.error('Error al guardar noticia:', error.message);
        }
      }

      // Delay entre fuentes para evitar bloqueos
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (error) {
      console.error(`Error procesando ${fuente.nombre}:`, error.message);
    }
  }

  console.log(`\n✨ Monitoreo completado: ${noticiasNuevas} noticias nuevas\n`);
}

// API REST Endpoints

// Obtener noticias recientes
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

// Obtener noticia por ID
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

// Buscar noticias
app.get('/api/buscar', (req, res) => {
  const query = req.query.q;
  
  if (!query) {
    return res.status(400).json({ error: 'Parámetro q requerido' });
  }

  const sql = `SELECT * FROM noticias 
               WHERE titulo LIKE ? OR resumen LIKE ?
               ORDER BY timestamp DESC LIMIT 50`;
  
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

// Registrar dispositivo para notificaciones
app.post('/api/registro-dispositivo', (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token requerido' });
  }

  db.run('INSERT OR REPLACE INTO dispositivos (token) VALUES (?)', [token], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ 
        success: true, 
        mensaje: 'Dispositivo registrado',
        topic: 'rocha-noticias'
      });
    }
  });
});

// Obtener estadísticas
app.get('/api/stats', (req, res) => {
  const queries = {
    total: 'SELECT COUNT(*) as count FROM noticias',
    hoy: 'SELECT COUNT(*) as count FROM noticias WHERE DATE(timestamp) = DATE("now")',
    porCategoria: 'SELECT categoria, COUNT(*) as count FROM noticias GROUP BY categoria',
    porFuente: 'SELECT fuente, COUNT(*) as count FROM noticias GROUP BY fuente'
  };

  const stats = {};

  db.get(queries.total, (err, row) => {
    stats.total = row.count;
    
    db.get(queries.hoy, (err, row) => {
      stats.hoy = row.count;
      
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Página de inicio
app.get('/', (req, res) => {
  res.json({
    nombre: 'API de Noticias de Rocha',
    version: '1.0.0',
    endpoints: [
      'GET /api/noticias',
      'GET /api/noticias/:id',
      'GET /api/buscar?q=texto',
      'POST /api/registro-dispositivo',
      'GET /api/stats',
      'GET /health'
    ]
  });
});

// Configurar cron jobs
cron.schedule('*/10 * * * *', () => {
  console.log('⏰ Ejecutando monitoreo programado...');
  monitorearFuentes();
});

// Limpieza diaria (eliminar noticias de más de 30 días)
cron.schedule('0 3 * * *', () => {
  console.log('🧹 Limpiando noticias antiguas...');
  db.run('DELETE FROM noticias WHERE timestamp < datetime("now", "-30 days")', (err) => {
    if (err) {
      console.error('Error en limpieza:', err);
    } else {
      console.log('✅ Limpieza completada');
    }
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  🌊 Sistema de Monitoreo de Noticias de Rocha       ║
║  🚀 Servidor iniciado en puerto ${PORT}                ║
║  📡 API disponible en http://localhost:${PORT}         ║
╚═══════════════════════════════════════════════════════╝
  `);
  
  // Ejecutar monitoreo inicial
  console.log('🔄 Ejecutando monitoreo inicial...');
  monitorearFuentes();
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando servidor...');
  db.close();
  process.exit(0);
});
