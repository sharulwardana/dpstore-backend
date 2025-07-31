// =======================================================
//          SERVER.JS VERSI SUPER-DEBUG
// =======================================================

// Langkah 1: Menangkap semua error yang tidak tertangani
process.on('uncaughtException', (err) => {
  console.error('FATAL ERROR: UNCAUGHT EXCEPTION! 💥');
  console.error('Pesan Error:', err.message);
  console.error('Stack Trace:', err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('FATAL ERROR: UNHANDLED REJECTION! 💥');
  console.error('Pesan Error:', err.message);
  console.error('Stack Trace:', err.stack);
  process.exit(1);
});
console.log('[DEBUG] Penangan error global aktif.');

// Langkah 2: Memuat environment variables
try {
  if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
  }
  console.log('[DEBUG] Environment variables berhasil dimuat.');
} catch (e) {
  console.error('[DEBUG] Gagal memuat dotenv:', e);
  process.exit(1);
}

// Langkah 3: Import semua modul
console.log('[DEBUG] Memulai import modul...');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);
const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
console.log('[DEBUG] Semua modul berhasil di-import.');

// Langkah 4: Membuat aplikasi Express
const app = express();
const port = process.env.PORT || 3000;
console.log(`[DEBUG] Aplikasi Express dibuat. Port akan diatur ke ${port}.`);

// Langkah 5: Konfigurasi Database Pool
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Hapus konfigurasi SSL untuk membiarkan driver PG menanganinya secara default
  });
  console.log('[DEBUG] Konfigurasi Pool Database selesai.');
} catch (e) {
  console.error('[DEBUG] Gagal mengkonfigurasi Pool Database:', e);
  process.exit(1);
}

// Langkah 6: Konfigurasi CORS
try {
    const allowedOrigins = ['https://zingy-zabaione-a27ed6.netlify.app', 'http://127.0.0.1:5500'];
    const corsOptions = {
        origin: function (origin, callback) {
            if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error(`Origin ${origin} tidak diizinkan oleh CORS`));
            }
        },
        credentials: true,
    };
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));
    console.log('[DEBUG] Middleware CORS berhasil diterapkan.');
} catch(e) {
    console.error('[DEBUG] Gagal menerapkan middleware CORS:', e);
    process.exit(1);
}

// Langkah 7: Middleware dasar
app.use(express.json());
console.log('[DEBUG] Middleware express.json diterapkan.');

// Langkah 8: Konfigurasi Session
try {
    app.set('trust proxy', 1);
    app.use(session({
        store: new pgSession({ pool: pool, tableName: 'user_sessions' }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { 
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 
        }
    }));
    console.log('[DEBUG] Middleware Session berhasil diterapkan.');
} catch(e) {
    console.error('[DEBUG] Gagal menerapkan middleware Session:', e);
    process.exit(1);
}

// Langkah 9: Konfigurasi Passport
try {
    app.use(passport.initialize());
    app.use(passport.session());

    passport.serializeUser((user, done) => done(null, user.user_id));
    passport.deserializeUser(async (id, done) => {
        try {
            const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
            done(null, result.rows[0]);
        } catch (err) {
            done(err, null);
        }
    });

    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.BACKEND_URL}/auth/google/callback`,
        proxy: true
    }, async (accessToken, refreshToken, profile, done) => {
        // Logika Google Strategy
    }));
    console.log('[DEBUG] Middleware Passport dan Google Strategy berhasil dikonfigurasi.');
} catch (e) {
    console.error('[DEBUG] Gagal mengkonfigurasi Passport:', e);
    process.exit(1);
}

// Langkah 10: Terapkan Rute
try {
    app.use('/api', publicRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/admin', adminRoutes);

    // Rute Google Auth
    app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
    app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/login.html` }),
        (req, res) => {
            res.redirect(`${process.env.FRONTEND_URL}/auth_callback.html`);
        }
    );
    console.log('[DEBUG] Semua rute berhasil diterapkan.');
} catch(e) {
    console.error('[DEBUG] Gagal menerapkan rute:', e);
    process.exit(1);
}

// Langkah 11: Mulai Server
app.listen(port, "0.0.0.0", () => {
    console.log(`[DEBUG] ✅ SERVER BERHASIL DIMULAI DAN BERJALAN DI PORT ${port}`);
    console.log(`=======================================================`);
});