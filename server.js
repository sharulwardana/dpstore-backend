// File: Project/dpstore-backend/server.js
// =======================================================
// BLOK PENANGANAN ERROR GLOBAL
// =======================================================
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});
// =======================================================

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const path = require('path');
const cors = require('cors');
// const session = require('express-session'); // NONAKTIFKAN
// const passport = require('passport'); // NONAKTIFKAN
// const GoogleStrategy = require('passport-google-oauth20'); // NONAKTIFKAN
const { Pool } = require('pg');
// const jwt = require('jsonwebtoken'); // NONAKTIFKAN

// --- Impor file rute baru ---
// const publicRoutes = require('./routes/publicRoutes'); // NONAKTIFKAN
// const authRoutes = require('./routes/authRoutes'); // NONAKTIFKAN
// const adminRoutes = require('./routes/adminRoutes'); // NONAKTIFKAN

const app = express();
const port = process.env.PORT || 3000;

// --- Konfigurasi Variabel Global (Dibiarkan, tidak menyebabkan error) ---
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// --- Konfigurasi Koneksi Database ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// =======================================================
// === BLOK DEBUGGING UNTUK MENGUJI KONEKSI ===
// =======================================================
async function testDbConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Koneksi ke database BERHASIL.');
    client.release();
  } catch (err) {
    console.error('❌ GAGAL terhubung ke database:', err.stack);
    process.exit(1); // Matikan paksa jika koneksi gagal agar error jelas terlihat
  }
}

testDbConnection();
// =======================================================

// --- CORS Configuration ---
const allowedOrigins = [
  'https://zingy-zabaione-a27ed6.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5500'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Origin tidak diizinkan oleh CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

/*
// =======================================================
// SEMUA KODE BERISIKO DI BAWAH INI DINONAKTIFKAN SEMENTARA
// =======================================================
const pgSession = require('connect-pg-simple')(session);

app.set('trust proxy', 1);
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'user_sessions'
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Hanya secure di production
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000
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
    callbackURL: `${process.env.BACKEND_URL}/auth/google/callback`,
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

// --- API Routes ---
app.use('/api', publicRoutes); 
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// --- RUTE AUTENTIKASI GOOGLE ---
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { 
        failureRedirect: `${process.env.FRONTEND_URL}/login.html` 
    }),
    (req, res) => {
        res.redirect(`${process.env.FRONTEND_URL}/auth_callback.html`);
    }
);
*/

// =======================================================
// KODE AKHIR SERVER
// =======================================================

// --- Menyajikan File Statis dari Frontend ---
// const frontendPath = path.join(__dirname, '../Dua Putra'); // NONAKTIFKAN SEMENTARA
// app.use(express.static(frontendPath)); // NONAKTIFKAN SEMENTARA

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', err.stack);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

app.listen(port, "0.0.0.0", () => { 
    console.log(`Server backend berjalan di port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
    console.log(`Backend URL: ${process.env.BACKEND_URL}`);
});
