const session = require('express-session');
const cookieParser = require('cookie-parser');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const app = express();
const port = 6789;
const incercariAutentificare = {};

const accesariEronate = {}; // Stocare IP-uri blocate

// Middleware setup
app.use(cookieParser());
app.use(session({
    secret: 'parola-super-secreta',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use((req, res, next) => {
    const ip = req.ip;
    const userData = accesariEronate[ip];

    if (userData && userData.blockedUntil && Date.now() < userData.blockedUntil) {
        return res.status(403).send('Acces blocat temporar (5 minute) din cauza accesărilor eronate.');
    }

    next();
});

app.set('view engine', 'ejs');
app.use(expressLayouts);
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    const ip = req.ip;
    const acum = Date.now();

    if (accesariErorate[ip] && accesariErorate[ip].blockedUntil > acum) {
        console.log(`Acces blocat de la IP ${ip}`);
        return res.status(403).send("Acces blocat temporar.");
    }

    next();
});


const db = new sqlite3.Database('./cumparaturi.db', (err) => {
    if (err) return console.error('Eroare DB:', err.message);
    console.log("Node.js + SQLite");
    console.log('Conectat la baza SQLite');
});

db.run(`CREATE TABLE IF NOT EXISTS utilizatori (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nume TEXT NOT NULL,
    parola TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'user'
)`);

db.get(`SELECT * FROM utilizatori WHERE nume = 'admin'`, (err, row) => {
    if (err) return console.error('Eroare verificare admin:', err.message);
    if (!row) {
        db.run(`INSERT INTO utilizatori (nume, parola, rol) VALUES (?, ?, ?)`, ['admin', 'admin', 'admin']);
    }
});

db.run(`CREATE TABLE IF NOT EXISTS produse (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nume TEXT NOT NULL,
    pret REAL NOT NULL
)`);

app.get('/creare-bd', (req, res) => {
    const produse = [
        { nume: 'Licență Microsoft Word', pret: 450 },
        { nume: 'Licență Adobe Photoshop', pret: 1200 },
        { nume: 'Model CV pentru licență', pret: 30 },
        { nume: 'Licență Microsoft Excel', pret: 400 },
        { nume: 'Dosar proiect licență', pret: 60 },
        { nume: 'Template PowerPoint Licență', pret: 70 },
        { nume: 'Ghid complet Licență Auto', pret: 250 },
        { nume: 'Manual de utilizare Licență', pret: 150 },
        { nume: 'Software Adobe Acrobat', pret: 1100 },
        { nume: 'Set complet documentație licență', pret: 350 }
    ];

    db.serialize(() => {
        db.run('DELETE FROM produse');
        const stmt = db.prepare('INSERT INTO produse (nume, pret) VALUES (?, ?)');
        produse.forEach(p => stmt.run(p.nume, p.pret));
        stmt.finalize(() => res.redirect('/'));
    });
});

app.get('/inserare-bd', (req, res) => {
    const produse = [
        { nume: 'Licență PowerPoint', pret: 60 },
        { nume: 'Licență Premier', pret: 200 },
        { nume: 'Model Examen Bacalaureat', pret: 50 },
    ];

    db.serialize(() => {
        const stmt = db.prepare('INSERT INTO produse (nume, pret) VALUES (?, ?)');
        produse.forEach(p => stmt.run(p.nume, p.pret));
        stmt.finalize(() => res.redirect('/'));
    });
});

app.use((req, res, next) => {
    if (!req.session.cos) req.session.cos = [];
    next();
});

app.get('/', (req, res) => {
    const utilizator = req.session.utilizator;
    const cosIds = req.session.cos || [];
    db.all('SELECT * FROM produse', [], (err, produse) => {
        if (err) return res.status(500).send('Eroare la citirea produselor.');
        const produseInCos = produse.filter(p => cosIds.includes(p.id));
        res.render('index', { utilizator, produse, cos: produseInCos });
    });
});

app.post('/adaugare_cos', (req, res) => {
    const idProdus = parseInt(req.body.id, 10);
    if (!isNaN(idProdus) && !req.session.cos.includes(idProdus)) {
        req.session.cos.push(idProdus);
    }
    res.redirect('/');
});

app.get('/vizualizare-cos', (req, res) => {
    const cosIds = req.session.cos || [];
    db.all('SELECT * FROM produse', [], (err, produse) => {
        if (err) return res.status(500).send('Eroare la accesarea bazei de date.');
        const produseInCos = produse.filter(p => cosIds.includes(p.id));
        res.render('vizualizare-cos', { produse: produseInCos });
    });
});

app.post('/sterge-din-cos', (req, res) => {
    const idProdus = parseInt(req.body.id, 10);
    if (!isNaN(idProdus)) {
        req.session.cos = req.session.cos.filter(id => id !== idProdus);
    }
    res.redirect('/vizualizare-cos');
});

app.get('/autentificare', (req, res) => {
    const mesajEroare = req.cookies.mesajEroare || '';
    res.clearCookie('mesajEroare');
    res.render('autentificare', { mesajEroare });
});

app.post('/verificare-autentificare', (req, res) => {
    const { utilizator, parola } = req.body;
    const ip = req.ip;

    // Protecție împotriva SQL Injection
    const patternInjection = /('|--|;|\bOR\b|\bAND\b|\bDROP\b|\bSELECT\b|\bINSERT\b|\bDELETE\b)/i;
    if (patternInjection.test(utilizator) || patternInjection.test(parola)) {
        console.log(`Tentativă SQL Injection de la IP ${ip} - user: ${utilizator}`);
        return res.status(403).send('Input invalid: posibila încercare de injectare SQL.');
    }

    // Inițializare dacă nu există
    if (!incercariAutentificare[ip]) {
        incercariAutentificare[ip] = { count: 0, last: Date.now() };
    }

    // Verificăm dacă IP-ul este blocat
    if (incercariAutentificare[ip].count >= 5 && Date.now() - incercariAutentificare[ip].last < 5 * 1000) {
        return res.status(403).send('Prea multe încercări. Încearcă mai târziu.');
    }

    // Interogare protejată prin parametrizare
    db.get('SELECT * FROM utilizatori WHERE nume = ? AND parola = ?', [utilizator, parola], (err, user) => {
        if (err || !user) {
            incercariAutentificare[ip].count++;
            incercariAutentificare[ip].last = Date.now();
            res.cookie('mesajEroare', 'Date incorecte!');
            return res.redirect('/autentificare');
        }

        // Resetăm contorul la succes
        incercariAutentificare[ip] = { count: 0, last: Date.now() };
        req.session.utilizator = user;
        res.redirect('/');
    });
});

// Pagina chestionar
app.get('/chestionar', (req, res) => {
    if (!req.session.utilizator) return res.redirect('/autentificare');

    fs.readFile('intrebari.json', (err, data) => {
        if (err) return res.status(500).send('Eroare la citirea fișierului cu întrebări.');
        const intrebari = JSON.parse(data);
        res.render('chestionar', { utilizator: req.session.utilizator, intrebari });
    });
});

// Rezultat chestionar
app.post('/rezultat-chestionar', (req, res) => {
    fs.readFile('intrebari.json', (err, data) => {
        if (err) return res.status(500).send('Eroare la citirea fișierului cu întrebări.');
        const intrebari = JSON.parse(data);
        const raspunsuri = req.body.intrebari || {};
        let scor = 0;
        intrebari.forEach((q, i) => {
            if (parseInt(raspunsuri[i]) === q.corect) scor++;
        });
        res.render('rezultat-chestionar', { scor, total: intrebari.length });
    });
});


app.get('/admin', (req, res) => {
    if (!req.session.utilizator || req.session.utilizator.rol !== 'admin') {
        return res.status(403).send('Acces interzis');
    }
    db.all('SELECT * FROM utilizatori', [], (err, utilizatori) => {
        if (err) return res.status(500).send('Eroare DB');
        res.render('admin', { utilizatori });
    });
});

app.post('/admin/adauga-produs', (req, res) => {
    if (!req.session.utilizator || req.session.utilizator.rol !== 'admin') {
        return res.status(403).send('Acces interzis');
    }
    const { nume, pret } = req.body;
    if (!nume || isNaN(pret)) return res.status(400).send('Date invalide');

    db.run('INSERT INTO produse (nume, pret) VALUES (?, ?)', [nume, parseFloat(pret)], (err) => {
        if (err) return res.status(500).send('Eroare la inserare produs');
        res.redirect('/admin');
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// Middleware pentru 404 și blocare IP
const accesariErorate = {};

app.use((req, res, next) => {
    const ip = req.ip;
    const acum = Date.now();

    if (accesariErorate[ip] && accesariErorate[ip].blockedUntil > acum) {
        return res.status(403).send("Acces blocat temporar.");
    }

    if (!accesariErorate[ip]) {
        accesariErorate[ip] = { count: 1, blockedUntil: 0 };
    } else {
        accesariErorate[ip].count++;
    }

    if (accesariErorate[ip].count >= 3) {
        accesariErorate[ip].blockedUntil = acum + 5 * 60 * 1000 // = 5000 milisecunde
        console.log(`IP ${ip} blocat pentru 5 secunde.`);
    } else {
        console.log(`Acces invalid de la IP: ${ip} (${accesariErorate[ip].count}/3)`);
    }

    res.status(404).send('Resursa nu a fost găsită.');
});

// Pornește serverul
app.listen(port, () => console.log(`Serverul rulează la http://localhost:${port}/`));
//    ' OR '1'='1