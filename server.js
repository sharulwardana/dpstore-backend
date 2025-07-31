// File: Project/dpstore-backend/server.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Trigger redeploy <-- TAMBAHKAN BARIS INI

const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// --- Impor file rute baru ---
const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const port = process.env.PORT || 3000;

// --- Konfigurasi Variabel Global ---
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// --- Konfigurasi Koneksi Database ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Aktifkan baris ini dengan menghapus tanda //
});

// --- Middleware Global ---
const corsOptions = {
  origin: 'https://zingy-zabaione-a27ed6.netlify.app', // <-- LANGSUNG TULIS URL DI SINI
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Baris ini tetap penting

app.use(express.json());

// === KONFIGURASI SESSION & PASSPORT ===
const pgSession = require('connect-pg-simple')(session); // Tambahkan baris ini

app.set('trust proxy', 1);
app.use(session({
    store: new pgSession({ // Tambahkan 'store' ini
        pool: pool, // Gunakan koneksi database yang sudah ada
        tableName: 'user_sessions' // Nama tabel untuk menyimpan sesi
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false, // Ubah menjadi false untuk best practice
    cookie: { 
        secure: true,
        httpOnly: true,
        sameSite: 'none',
        maxAge: 30 * 24 * 60 * 60 * 1000 // Opsional: Sesi berlaku 30 hari
    } 
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user.user_id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
        done(null, result.rows[0]);
    } catch (err) {
        done(err, null);
    }
});

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL}/auth/google/callback`, // Menggunakan variabel dari .env
    proxy: true
},
async (accessToken, refreshToken, profile, done) => {
    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
        
        if (existingUser.rows.length > 0) {
            return done(null, existingUser.rows[0]);
        }
        
        const newUserResult = await pool.query(
            'INSERT INTO users (google_id, full_name, email) VALUES ($1, $2, $3) RETURNING *',
            [profile.id, profile.displayName, profile.emails[0].value]
        );
        return done(null, newUserResult.rows[0]);

    } catch (err) {
        return done(err, false);
    }
}));

// === LOGGING & MENGGUNAKAN RUTE ===
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.use('/api', publicRoutes); 
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// --- RUTE AUTENTIKASI GOOGLE ---
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: 'https://zingy-zabaione-a27ed6.netlify.app/login.html' }),
    (req, res) => {
        res.redirect('https://zingy-zabaione-a27ed6.netlify.app/auth_callback.html');
    }
);

// --- Menyajikan File Statis dari Frontend ---
const frontendPath = path.join(__dirname, '../Dua Putra');
app.use(express.static(frontendPath));

app.listen(port, () => { 
    console.log(`Server backend berjalan di port ${port}`);
});