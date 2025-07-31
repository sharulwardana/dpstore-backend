// D:\dpstore-backend\server.js
require('dotenv').config();

const axios = require('axios');
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20')
const authMiddleware = require('./middleware/authMiddleware'); // Pastikan path ini benar
const adminAuthMiddleware = require('./middleware/adminAuthMiddleware'); // Pastikan path ini benar
const { body, param, validationResult } = require('express-validator');

const app = express();
const port = 3000;

// --- Konfigurasi Variabel Global ---
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// --- KREDENSIAL ADMIN YANG AMAN ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH; 

// --- Konfigurasi Nodemailer ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

transporter.verify(function(error, success) {
    if (error) {
        console.error("Nodemailer: Error koneksi transporter -", error);
    } else {
        console.log("Nodemailer: Server siap menerima email");
    }
});

// --- Fungsi Helper Pengiriman Email ---
async function sendEmailNotification(to, subject, htmlContent) {
    const mailOptions = {
        from: '"DPStore Notifikasi" <herualfatih36@gmail.com>',
        to: to,
        subject: subject,
        html: htmlContent
    };
    try {
        let info = await transporter.sendMail(mailOptions);
        console.log('Email notifikasi terkirim: %s ke %s', info.messageId, to);
        return true;
    } catch (error) {
        console.error('Gagal mengirim email notifikasi ke %s:', to, error);
        return false;
    }
}

// --- Konfigurasi Koneksi Database ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// --- Middleware Global ---
app.use(cors({
    origin: 'https://zingy-zabaione-a27ed6.netlify.app', // Izinkan hanya dari website Netlify Anda
    credentials: true // Izinkan pengiriman cookie
}));
app.use(express.json());

// === KONFIGURASI SESSION & PASSPORT (BARU) ===
app.set('trust proxy', 1); // <-- TAMBAHKAN BARIS INI
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: true, // Wajib true karena kita lintas domain via HTTPS
        httpOnly: true,
        sameSite: 'none' // Izinkan cookie dikirim dari domain lain (Netlify)
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
    callbackURL: "https://dpstore-backend-production.up.railway.app/auth/google/callback",
    proxy: true
},
async (accessToken, refreshToken, profile, done) => {
    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
        
        if (existingUser.rows.length > 0) {
            // Pengguna sudah ada, langsung login
            return done(null, existingUser.rows[0]);
        }
        
        // Pengguna belum ada, buat akun baru
        const newUserResult = await pool.query(
            'INSERT INTO users (google_id, full_name, email) VALUES ($1, $2, $3) RETURNING *',
            [profile.id, profile.displayName, profile.emails[0].value]
        );
        return done(null, newUserResult.rows[0]);

    } catch (err) {
        return done(err, false);
    }
}));
// === AKHIR KONFIGURASI PASSPORT ===

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// --- Menyajikan File Statis dari Folder Frontend 'Dua Putra' ---
const frontendPath = path.join(__dirname, '../Dua Putra');
console.log(`[SERVER] Menyajikan file statis dari: ${frontendPath}`);
app.use(express.static(frontendPath));
// --------------------------------------------------------------------

// =======================================================
// --- RUTE AUTENTIKASI GOOGLE (BARU & DIPERBAIKI) ---
// =======================================================
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// PERUBAHAN 1: Ubah redirect ke halaman callback baru kita
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    (req, res) => {
        // Setelah login Google berhasil, arahkan ke halaman perantara di frontend
        res.redirect('https://zingy-zabaione-a27ed6.netlify.app/auth_callback.html');
    }
);

// PERUBAHAN 2: Buat endpoint baru untuk memberikan token ke frontend
app.get('/api/auth/session-token', (req, res) => {
    // Cek apakah pengguna sudah login via session (dari Passport.js)
    if (req.isAuthenticated()) {
        const user = req.user;
        const payload = { 
            user: { 
                id: user.user_id, 
                email: user.email, 
                fullName: user.full_name 
            } 
        };
        // Buat token JWT untuk pengguna ini
        jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
            if (err) {
                return res.status(500).json({ error: 'Gagal membuat token.' });
            }
            // Kirim token dan data pengguna sebagai JSON
            res.json({ token, user: payload.user });
        });
    } else {
        // Jika tidak ada session, kirim error
        res.status(401).json({ error: 'Tidak ada sesi aktif.' });
    }
});

// --- Endpoint API GAME & PRODUK ---
app.get('/api/games', async (req, res) => {
    try {
        const result = await pool.query(
    'SELECT game_id, name, slug, image_url, category, header_promo_text, created_at FROM games WHERE is_active = TRUE ORDER BY created_at DESC'
);
        res.json(result.rows);
    } catch (err) {
        console.error('Error saat mengambil data games:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil games' });
    }
});

app.get('/api/games/search', async (req, res) => {
    const { q } = req.query; 

    if (!q || q.trim() === '') {
        try {
            const result = await pool.query('SELECT game_id, name, slug, image_url, category, header_promo_text FROM games WHERE is_active = TRUE ORDER BY name');
            return res.json(result.rows);
        } catch (err) {
            console.error('Error saat mengambil semua game (pencarian kosong):', err.stack);
            return res.status(500).json({ error: 'Terjadi kesalahan pada server' });
        }
    }

    try {
        const result = await pool.query(
            `SELECT game_id, name, slug, image_url, category, header_promo_text 
             FROM games 
             WHERE name ILIKE $1 AND is_active = TRUE 
             ORDER BY name`,
            [`%${q}%`]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error saat melakukan pencarian game:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server saat mencari game' });
    }
});

app.get('/api/games/:slug', async (req, res) => {
    const { slug } = req.params;
    try {
        const gameResult = await pool.query(
            `SELECT game_id, name, slug, image_url, hero_image_url, 
                    user_id_help AS "userIdHelp",
                    app_store_url AS "appStoreUrl", 
                    google_play_url AS "googlePlayUrl", 
                    description AS "descriptionForLeftColumn", 
                    payment_methods_summary AS "paymentMethodsSummary",
                    purchase_instructions AS "purchaseInstructions",
                    header_promo_text 
             FROM games 
             WHERE slug = $1 AND is_active = TRUE`,
            [slug]
        );

        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game tidak ditemukan' });
        }
        const gameData = gameResult.rows[0];
        gameData.paymentMethodsSummary = gameData.paymentMethodsSummary || "<p>Metode pembayaran beragam tersedia.</p>";
        gameData.purchaseInstructions = gameData.purchaseInstructions || "<p>Ikuti langkah mudah untuk membeli.</p>";

        const productResult = await pool.query(
            `SELECT product_id, name, price, description AS product_description
             FROM products
             WHERE game_id = $1 AND is_active = TRUE
             ORDER BY price ASC`,
            [gameData.game_id]
        );
        
        const nominals = productResult.rows.map(prod => ({
            product_id: prod.product_id,
            name: prod.name,
            price: `Rp ${parseInt(prod.price).toLocaleString('id-ID')}`,
            basePrice: parseInt(prod.price)
        }));

        const responseData = {
            ...gameData,
            nominals: nominals
        };
        res.json(responseData);
    } catch (err) {
        console.error(`Error saat mengambil detail game (slug: ${slug}):`, err.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil detail game' });
        }
    }
});

app.get('/api/products/:game_slug', async (req, res) => {
    const { game_slug } = req.params;
    try {
        const productResult = await pool.query(
            `SELECT p.product_id, p.name, p.price, p.description AS product_description
             FROM products p
             JOIN games g ON p.game_id = g.game_id
             WHERE g.slug = $1 AND p.is_active = TRUE AND g.is_active = TRUE
             ORDER BY p.price ASC`,
            [game_slug]
        );
        const nominals = productResult.rows.map(prod => ({
            product_id: prod.product_id,
            name: prod.name,
            price: `Rp ${parseInt(prod.price).toLocaleString('id-ID')}`,
            basePrice: parseInt(prod.price)
        }));
        res.json(nominals);
    } catch (err) {
        console.error(`Error saat mengambil produk untuk game (slug: ${game_slug}):`, err.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil produk' });
        }
    }
});

// --- ENDPOINT UNTUK DATA STATIS ---
app.get('/api/payment-methods', (req, res) => {
    const paymentMethods = [
        { id: "gopay", name: "GoPay", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Gopay_logo.svg/1200px-Gopay_logo.svg.png" },
        { id: "ovo", name: "OVO", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Logo_ovo_purple.svg/1200px-Logo_ovo_purple.svg.png" },
        { id: "dana", name: "Dana", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Logo_dana_blue.svg/1200px-Logo_dana_blue.svg.png" },
        { id: "bank_transfer", name: "Bank Transfer", logo: null, iconClass: "fas fa-university fa-lg text-purple-400 w-[24px] text-center" },
        { id: "alfamart", name: "Alfamart", logo: "https://upload.wikimedia.org/wikipedia/commons/9/9e/ALFAMART_LOGO_BARU.png"},
        { id: "shopeepay", name: "ShopeePay", logo: "https://shopeepay.co.id/src/pages/home/assets/images/new-homepage/new-spp-logo.svg"},
        { id: "qris", name: "Qris", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Logo_QRIS.svg/2560px-Logo_QRIS.svg.png"},
        { id: "indomaret", name: "Indomaret", logo: "https://upload.wikimedia.org/wikipedia/commons/9/9d/Logo_Indomaret.png"},
        { id: "linkaja", name: "Link Aja", logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/LinkAja.svg/2048px-LinkAja.svg.png"}
    ];
    res.json(paymentMethods);
});

// --- REVIEWS ENDPOINTS ---
app.get('/api/reviews/:game_slug', async (req, res) => {
    const { game_slug } = req.params;
    try {
        const result = await pool.query(
            `SELECT 
                r.rating, r.review_text, r.created_at,
                u.full_name AS customer_name
             FROM reviews r
             JOIN users u ON r.user_id = u.user_id
             JOIN games g ON r.game_id = g.game_id
             WHERE g.slug = $1 AND r.is_visible = TRUE
             ORDER BY r.created_at DESC`,
            [game_slug]
        );

        const statsResult = await pool.query(
            `SELECT 
                COUNT(r.review_id) AS total_reviews,
                AVG(r.rating) AS average_rating
             FROM reviews r
             JOIN games g ON r.game_id = g.game_id
             WHERE g.slug = $1 AND r.is_visible = TRUE`,
             [game_slug]
        );

        const stats = {
            total_reviews: parseInt(statsResult.rows[0].total_reviews) || 0,
            average_rating: parseFloat(statsResult.rows[0].average_rating).toFixed(1) || "0.0"
        };

        const formattedReviews = result.rows.map(review => ({
            ...review,
            formatted_date: new Date(review.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        }));

        res.json({
            reviews: formattedReviews,
            stats: stats
        });

    } catch (err) {
        console.error(`Error saat mengambil ulasan untuk game ${game_slug}:`, err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

app.post('/api/reviews', 
    [
        authMiddleware,
        body('gameId', 'ID Game harus valid').isInt(),
        body('rating', 'Rating harus antara 1 dan 5').isInt({ min: 1, max: 5 }),
        body('reviewText', 'Ulasan tidak boleh terlalu panjang').optional().isLength({ max: 1000 }).trim().escape()
    ], 
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'Akses ditolak. Anda harus login untuk memberi ulasan.' });
        }

        const { gameId, rating, reviewText } = req.body;
        const userId = req.user.id;

        try {
            const existingReview = await pool.query(
                'SELECT review_id FROM reviews WHERE user_id = $1 AND game_id = $2',
                [userId, gameId]
            );

            if (existingReview.rows.length > 0) {
                return res.status(409).json({ error: 'Anda sudah pernah memberikan ulasan untuk game ini.' });
            }

            const newReviewResult = await pool.query(
                'INSERT INTO reviews (game_id, user_id, rating, review_text) VALUES ($1, $2, $3, $4) RETURNING *',
                [gameId, userId, rating, reviewText]
            );

            res.status(201).json({
                message: 'Ulasan Anda berhasil dikirim!',
                review: newReviewResult.rows[0]
            });

        } catch (err) {
            console.error('Error saat mengirim ulasan:', err.stack);
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Anda sudah pernah memberikan ulasan untuk game ini.' });
            }
            res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengirim ulasan.' });
        }
    }
);

// --- TESTIMONIALS ENDPOINT ---
app.get('/api/testimonials', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT customer_name, game_name, rating, review_text, created_at FROM testimonials WHERE is_visible = TRUE ORDER BY created_at DESC'
        );

        const formattedTestimonials = result.rows.map(testimonial => ({
            ...testimonial,
            formatted_date: new Date(testimonial.created_at).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            })
        }));
        res.json(formattedTestimonials);
    } catch (err) {
        console.error('Error saat mengambil data testimonials:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil ulasan.' });
    }
});

// --- AUTH ENDPOINTS ---
app.post('/api/auth/register',
    [
        body('fullName', 'Nama lengkap harus diisi').notEmpty().trim().escape(),
        body('email', 'Masukkan email yang valid').isEmail().normalizeEmail(),
        body('password', 'Password minimal harus 8 karakter').isLength({ min: 8 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { fullName, email, password } = req.body;
        try {
            const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userCheck.rows.length > 0) {
                return res.status(409).json({ errors: [{ msg: 'Email sudah terdaftar.' }] });
            }
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);
            const newUserResult = await pool.query(
                'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id, email, full_name, created_at',
                [fullName, email, passwordHash]
            );
            const newUser = newUserResult.rows[0];
            res.status(201).json({
                message: 'Registrasi berhasil!',
                user: newUser
            });
            const emailSubject = 'Selamat Datang di DPStore!';
            const emailHTML = `<h1>Halo ${newUser.full_name},</h1><p>Terima kasih telah mendaftar di DPStore! Akun Anda telah berhasil dibuat.</p><p>Anda sekarang bisa menikmati kemudahan top-up game favorit Anda.</p><p>Selamat bermain!</p><br><p>Salam,</p><p>Tim DPStore</p>`;
            sendEmailNotification(newUser.email, emailSubject, emailHTML)
                .catch(err => console.error("Gagal mengirim email registrasi di background:", err));
        } catch (err) {
            console.error('Error saat registrasi:', err.stack);
            if (!res.headersSent) {
                res.status(500).json({ errors: [{ msg: 'Terjadi kesalahan pada server saat registrasi' }] });
            }
        }
    }
);

app.post('/api/auth/login',
    [
        body('email', 'Masukkan email yang valid').isEmail().normalizeEmail(),
        body('password', 'Password harus diisi').notEmpty()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { email, password } = req.body;
        try {
            const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userResult.rows.length === 0) {
                return res.status(401).json({ errors: [{ msg: 'Email atau password salah.' }] });
            }
            const user = userResult.rows[0];
            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (!isMatch) {
                return res.status(401).json({ errors: [{ msg: 'Email atau password salah.' }] });
            }
            const payload = { user: { id: user.user_id, email: user.email, fullName: user.full_name } };
            jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
                if (err) throw err;
                res.json({ message: 'Login berhasil!', token, user: payload.user });
            });
        } catch (err) {
            console.error('Error saat login:', err.stack);
            if (!res.headersSent) {
                res.status(500).json({ errors: [{ msg: 'Terjadi kesalahan pada server saat login' }] });
            }
        }
    }
);

app.get('/api/auth/me', (req, res) => { // Hapus authMiddleware, kita cek manual
    if (req.isAuthenticated()) { // Cek session dari Passport.js
        const user = req.user;
        const userData = {
            user_id: user.user_id,
            email: user.email,
            full_name: user.full_name,
            rewards_balance: user.rewards_balance || 0,
            created_at: user.created_at
        };
        userData.rewards_balance_formatted = `Rp ${parseInt(userData.rewards_balance).toLocaleString('id-ID')}`;
        return res.json(userData);
    }
    
    // Fallback ke JWT (jika masih ingin mendukung)
    authMiddleware(req, res, async () => {
        if (req.user && req.user.id) {
             const userFromDb = await pool.query('SELECT user_id, email, full_name, rewards_balance, created_at FROM users WHERE user_id = $1', [req.user.id]);
             if(userFromDb.rows.length > 0) {
                const userData = userFromDb.rows[0];
                userData.rewards_balance_formatted = `Rp ${parseInt(userData.rewards_balance || 0).toLocaleString('id-ID')}`;
                return res.json(userData);
             }
        }
        return res.status(401).json({ error: 'Tidak terautentikasi.' });
    });
});

// PUT: Memperbarui data pengguna (misalnya, nama lengkap)
app.put('/api/auth/me', 
    [
        authMiddleware,
        body('fullName', 'Nama lengkap harus diisi').notEmpty().trim().escape()
    ], 
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'Akses ditolak. Anda harus login.' });
        }

        const { fullName } = req.body;
        const userId = req.user.id;

        try {
            const updateUser = await pool.query(
                'UPDATE users SET full_name = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 RETURNING user_id, email, full_name',
                [fullName, userId]
            );

            if (updateUser.rowCount === 0) {
                return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
            }

            // Kirim kembali data pengguna yang sudah diperbarui
            const updatedUserData = updateUser.rows[0];
            res.json({
                message: 'Profil berhasil diperbarui!',
                user: {
                    id: updatedUserData.user_id,
                    email: updatedUserData.email,
                    fullName: updatedUserData.full_name
                }
            });

        } catch (err) {
            console.error('[AUTH] Error saat memperbarui profil pengguna:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

app.put('/api/auth/change-password',
    [
        authMiddleware,
        body('oldPassword', 'Password lama harus diisi').notEmpty(),
        body('newPassword', 'Password baru minimal harus 8 karakter').isLength({ min: 8 }),
        body('confirmNewPassword', 'Konfirmasi password baru harus diisi').notEmpty()
            .custom((value, { req }) => {
                if (value !== req.body.newPassword) {
                    throw new Error('Konfirmasi password baru tidak cocok dengan password baru.');
                }
                return true;
            })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { oldPassword, newPassword } = req.body;
        const userId = req.user.id;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const userResult = await client.query('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ errors: [{ msg: 'Pengguna tidak ditemukan.' }] });
            }
            const currentPasswordHash = userResult.rows[0].password_hash;
            const isOldPasswordMatch = await bcrypt.compare(oldPassword, currentPasswordHash);
            if (!isOldPasswordMatch) {
                await client.query('ROLLBACK');
                return res.status(401).json({ errors: [{ msg: 'Password lama yang Anda masukkan salah.' }] });
            }
            const salt = await bcrypt.genSalt(10);
            const newPasswordHash = await bcrypt.hash(newPassword, salt);
            await client.query(
                'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [newPasswordHash, userId]
            );
            await client.query('COMMIT');
            res.json({ message: 'Password berhasil diubah.' });
            const emailSubject = 'Kata Sandi DPStore Anda Telah Diubah';
            const emailHTML = `<p>Halo ${req.user.fullName},</p><p>Ini adalah konfirmasi bahwa kata sandi untuk akun Anda telah berhasil diubah melalui halaman profil. Jika Anda tidak melakukan perubahan ini, segera hubungi dukungan kami.</p>`;
            sendEmailNotification(req.user.email, emailSubject, emailHTML).catch(err => console.error("Gagal mengirim email notifikasi ubah password:", err));
            // ---> AKHIR BLOK TAMBAHAN <---
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Error saat mengubah password:', err.stack);
            if (!res.headersSent) {
                res.status(500).json({ errors: [{ msg: 'Terjadi kesalahan pada server saat mengubah password.' }] });
            }
        } finally {
            client.release();
        }
    }
);

// --- TRANSACTION ENDPOINTS ---
app.get('/api/transactions/me', authMiddleware, async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'Akses ditolak. Anda harus login.' });
        }
        const userId = req.user.id;
        const transactionsResult = await pool.query(
    `SELECT 
        t.transaction_id, t.external_id, t.created_at, 
        p.name AS product_name, g.name AS game_name, g.slug AS game_slug,
        t.total_price, t.status,
        t.rewards_earned, t.rewards_used
     FROM transactions t
     JOIN products p ON t.product_id = p.product_id
     JOIN games g ON p.game_id = g.game_id
     WHERE t.user_id = $1
     ORDER BY t.created_at DESC`,
    [userId]
);
        const formattedTransactions = transactionsResult.rows.map(tx => ({
            ...tx,
            created_at_formatted: new Date(tx.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
            total_price_formatted: `Rp ${parseInt(tx.total_price).toLocaleString('id-ID')}`,
            status_formatted: tx.status ? tx.status.charAt(0).toUpperCase() + tx.status.slice(1).toLowerCase() : 'N/A',
            rewards_earned_formatted: tx.rewards_earned && parseInt(tx.rewards_earned) > 0 ? `+${parseInt(tx.rewards_earned).toLocaleString('id-ID')} Poin` : '-',
            rewards_used_formatted: tx.rewards_used && parseInt(tx.rewards_used) > 0 ? `-${parseInt(tx.rewards_used).toLocaleString('id-ID')} Poin` : '-'
        }));
        res.json(formattedTransactions);
    } catch (err) {
        console.error('[BACKEND] Error saat mengambil riwayat transaksi pengguna:', err.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil riwayat transaksi' });
        }
    }
});

app.post('/api/transactions',
    [
        authMiddleware,
        body('productId', 'ID Produk harus angka dan wajib diisi').exists().isInt(),
        body('quantity', 'Kuantitas harus angka positif').isInt({ gt: 0 }),
        body('userGameId', 'User Game ID harus diisi').notEmpty().trim().escape(),
        body('paymentMethod', 'Metode Pembayaran harus diisi').notEmpty().trim().escape(),
        body('emailForGuest', 'Format email tamu tidak valid').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
        body('useRewards', 'Gunakan Rewards harus boolean').optional().isBoolean()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const {
            productId, quantity, userGameId,
            paymentMethod, emailForGuest, useRewards
        } = req.body;
        const userId = req.user ? req.user.id : null;
        if (!userId && !emailForGuest) {
            return res.status(400).json({ errors: [{ type: 'field', msg: 'Email harus diisi untuk pembelian sebagai tamu.', path: 'emailForGuest', location: 'body' }] });
        }
        const client = await pool.connect();
        let product;
        try {
            await client.query('BEGIN');
            const productResult = await client.query('SELECT price, name FROM products WHERE product_id = $1 AND is_active = TRUE', [parseInt(productId)]);
            if (productResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ errors: [{ msg: 'Produk tidak ditemukan atau tidak aktif.' }] });
            }
            product = productResult.rows[0];
            const pricePerItem = parseFloat(product.price);
            let totalPrice = pricePerItem * parseInt(quantity);
            let rewardsUsed = 0;
            if (userId && useRewards === true) {
                const userResult = await client.query('SELECT rewards_balance, full_name, email FROM users WHERE user_id = $1', [userId]);
                if (userResult.rows.length > 0) {
                     if(req.user){ 
                         req.user.fullName = userResult.rows[0].full_name; 
                         req.user.email = userResult.rows[0].email;
                     }
                    let currentRewardsBalance = parseInt(userResult.rows[0].rewards_balance);
                    if (currentRewardsBalance > 0) {
                        let potentialDiscount = Math.floor(totalPrice * 0.10);
                        rewardsUsed = Math.min(potentialDiscount, currentRewardsBalance);
                        totalPrice -= rewardsUsed;
                        totalPrice = Math.max(0, totalPrice);
                        await client.query(
                            'UPDATE users SET rewards_balance = rewards_balance - $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                            [rewardsUsed, userId]
                        );
                    }
                }
            }
            const timestampPart = Date.now().toString();
            const randomPart = Math.random().toString(36).substring(2, 5).toUpperCase();
            const externalId = `TX-DP-${timestampPart}-${randomPart}`;
            const newTransactionResult = await client.query(
                `INSERT INTO transactions 
                    (external_id, user_id, product_id, quantity, price_per_item, total_price, payment_method, status, user_game_id, email_for_guest, rewards_used) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
                 RETURNING transaction_id, external_id, status, created_at, total_price, rewards_used`,
                [
                    externalId, userId, parseInt(productId), parseInt(quantity),
                    pricePerItem, totalPrice, paymentMethod, 'PENDING',
                    userGameId, userId ? null : (emailForGuest || null),
                    rewardsUsed
                ]
            );
            const createdTransaction = newTransactionResult.rows[0];
            await client.query('COMMIT');
            res.status(201).json({
                message: 'Pesanan berhasil dibuat dan menunggu pembayaran.',
                transaction: createdTransaction
            });
            const recipientEmail = userId && req.user ? req.user.email : emailForGuest;
            const userFullName = userId && req.user ? req.user.fullName : 'Pelanggan';
            if (recipientEmail && product) {
                const emailSubject = `Pesanan DPStore Anda #${createdTransaction.external_id} Telah Diterima`;
                // Ganti komentar dengan konten di bawah ini
                const emailHTML = `
                    <div style="font-family: Arial, sans-serif; color: #333;">
                        <h1 style="color: #5a3ea1;">Halo ${userFullName},</h1>
                        <p>Terima kasih telah melakukan pemesanan di DPStore. Pesanan Anda telah kami terima dan sedang menunggu pembayaran.</p>
                        <h3 style="border-bottom: 2px solid #eee; padding-bottom: 5px;">Detail Pesanan</h3>
                        <p><strong>ID Pesanan:</strong> ${createdTransaction.external_id}</p>
                        <p><strong>Item:</strong> ${product.name} (Qty: ${quantity})</p>
                        <p><strong>User Game ID:</strong> ${userGameId}</p>
                        <p><strong>Metode Pembayaran:</strong> ${paymentMethod}</p>
                        <h3 style="margin-top: 20px;">Total Pembayaran: <span style="color: #eab308;">${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(totalPrice)}</span></h3>
                        <p>Silakan selesaikan pembayaran Anda agar pesanan dapat segera kami proses.</p>
                        <br>
                        <p>Salam,<br>Tim DPStore</p>
                    </div>
                `;
                sendEmailNotification(recipientEmail, emailSubject, emailHTML)
                    .catch(err => console.error("Gagal mengirim email notifikasi pesanan di background:", err));
            }
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Error saat membuat transaksi:', err.stack);
            if (!res.headersSent) {
                res.status(500).json({ errors: [{ msg: 'Terjadi kesalahan pada server saat memproses pesanan Anda.' }] });
            }
        } finally {
            client.release();
        }
    }
);

app.get('/api/transactions/check/:externalId', async (req, res) => {
    const { externalId } = req.params;
    if (!externalId) {
        return res.status(400).json({ error: 'ID Transaksi (External ID) harus diisi.' });
    }
    try {
        const transactionResult = await pool.query(
            `SELECT 
                t.*, p.name AS product_name, g.name AS game_name
             FROM transactions t
             LEFT JOIN products p ON t.product_id = p.product_id 
             LEFT JOIN games g ON p.game_id = g.game_id 
             WHERE t.external_id = $1`,
            [externalId.toUpperCase()]
        );
        if (transactionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        }
        const transactionData = transactionResult.rows[0];
        transactionData.created_at_formatted = new Date(transactionData.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        transactionData.total_price_formatted = `Rp ${parseInt(transactionData.total_price).toLocaleString('id-ID')}`;
        transactionData.status_formatted = transactionData.status ? transactionData.status.charAt(0).toUpperCase() + transactionData.status.slice(1).toLowerCase() : 'N/A';
        transactionData.rewards_earned_formatted = transactionData.rewards_earned && parseInt(transactionData.rewards_earned) > 0 ? `+${parseInt(transactionData.rewards_earned).toLocaleString('id-ID')} Poin` : '-';
        transactionData.rewards_used_formatted = transactionData.rewards_used && parseInt(transactionData.rewards_used) > 0 ? `-${parseInt(transactionData.rewards_used).toLocaleString('id-ID')} Poin` : '-';
        res.json(transactionData);
    } catch (err) {
        console.error(`Error saat mengecek transaksi (externalId: ${externalId}):`, err.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengecek transaksi.' });
        }
    }
});

// =======================================================
// --- FAVORITES / WISHLIST ENDPOINTS ---
// =======================================================

// Middleware untuk memastikan pengguna sudah login
const requireLogin = (req, res, next) => {
    if (req.user && req.user.id) {
        return next();
    }
    // Jika menggunakan session dari Google, cek juga req.isAuthenticated()
    if (req.isAuthenticated()) {
        // Sinkronkan req.user dari session passport ke format JWT kita
        req.user = { id: req.user.user_id, email: req.user.email, fullName: req.user.full_name };
        return next();
    }
    return res.status(401).json({ error: 'Akses ditolak. Anda harus login.' });
};


// GET: Mendapatkan semua game favorit milik pengguna yang sedang login
app.get('/api/favorites/me', authMiddleware, requireLogin, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await pool.query(`
            SELECT g.game_id, g.name, g.slug, g.image_url
            FROM games g
            JOIN user_favorites uf ON g.game_id = uf.game_id
            WHERE uf.user_id = $1
            ORDER BY uf.created_at DESC
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('[FAVORITES] Error saat mengambil data favorit:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// POST: Menambahkan game ke daftar favorit
app.post('/api/favorites', authMiddleware, requireLogin, [body('gameId', 'ID Game harus valid').isInt()], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const { gameId } = req.body;

    try {
        const newFavorite = await pool.query(
            'INSERT INTO user_favorites (user_id, game_id) VALUES ($1, $2) ON CONFLICT (user_id, game_id) DO NOTHING RETURNING *',
            [userId, gameId]
        );
        if (newFavorite.rows.length > 0) {
            res.status(201).json({ message: 'Game berhasil ditambahkan ke favorit.', favorite: newFavorite.rows[0] });
        } else {
            res.status(200).json({ message: 'Game sudah ada di daftar favorit.' });
        }
    } catch (err) {
        console.error('[FAVORITES] Error saat menambah favorit:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});


// DELETE: Menghapus game dari daftar favorit
app.delete('/api/favorites/:gameId', authMiddleware, requireLogin, [param('gameId', 'ID Game harus valid').isInt()], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    const userId = req.user.id;
    const { gameId } = req.params;

    try {
        const deleteResult = await pool.query(
            'DELETE FROM user_favorites WHERE user_id = $1 AND game_id = $2',
            [userId, gameId]
        );
        if (deleteResult.rowCount > 0) {
            res.json({ message: 'Game berhasil dihapus dari favorit.' });
        } else {
            res.status(404).json({ error: 'Game tidak ditemukan di daftar favorit Anda.' });
        }
    } catch (err) {
        console.error('[FAVORITES] Error saat menghapus favorit:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// Jangan lupa untuk mengimpor body dan param dari express-validator di bagian atas file server.js
// Pastikan baris ini ada: const { body, param, validationResult } = require('express-validator');

// =======================================================
// --- ADMIN ENDPOINTS ---
// =======================================================

// PERBAIKAN 1: Endpoint dashboard dipindahkan ke sini
app.get('/api/admin/dashboard-stats', adminAuthMiddleware, async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const incomeTodayResult = await pool.query("SELECT SUM(total_price) as total FROM transactions WHERE status = 'SUCCESS' AND created_at >= $1", [todayStart]);
        const incomeToday = incomeTodayResult.rows[0].total || 0;

        const transactionsTodayResult = await pool.query("SELECT COUNT(transaction_id) as count FROM transactions WHERE created_at >= $1", [todayStart]);
        const transactionsToday = transactionsTodayResult.rows[0].count || 0;
        
        const newUsersTodayResult = await pool.query("SELECT COUNT(user_id) as count FROM users WHERE created_at >= $1", [todayStart]);
        const newUsersToday = newUsersTodayResult.rows[0].count || 0;
        
        const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
        const transactionsThisMonthResult = await pool.query("SELECT COUNT(transaction_id) as count FROM transactions WHERE created_at >= $1", [monthStart]);
        const transactionsThisMonth = transactionsThisMonthResult.rows[0].count || 0;

        res.json({ incomeToday, transactionsToday, newUsersToday, transactionsThisMonth });
    } catch (err) {
        console.error('[ADMIN] Error saat mengambil statistik dashboard:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// --- ADMIN PROMOTIONS ENDPOINTS ---

// GET (Public): Mengambil semua promosi yang aktif untuk ditampilkan di halaman utama
app.get('/api/promotions', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM promotions WHERE is_active = TRUE ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error saat mengambil promosi:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// GET (Admin): Mengambil semua promosi (aktif dan nonaktif) untuk panel admin
app.get('/api/admin/promotions', adminAuthMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM promotions ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('[ADMIN] Error saat mengambil promosi:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// POST (Admin): Membuat promosi baru
app.post('/api/admin/promotions', adminAuthMiddleware, [
    body('title', 'Judul harus diisi').notEmpty(),
    body('image_url', 'URL Gambar harus valid').isURL()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { title, description, image_url, link_url, is_active } = req.body;
    try {
        const newPromo = await pool.query(
            'INSERT INTO promotions (title, description, image_url, link_url, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, description, image_url, link_url, is_active]
        );
        res.status(201).json(newPromo.rows[0]);
    } catch (err) {
        console.error('[ADMIN] Error saat membuat promosi:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan server.' });
    }
});

// PUT (Admin): Memperbarui promosi
app.put('/api/admin/promotions/:id', adminAuthMiddleware, [
    body('title', 'Judul harus diisi').notEmpty(),
    body('image_url', 'URL Gambar harus valid').isURL()
], async (req, res) => {
    const { id } = req.params;
    const { title, description, image_url, link_url, is_active } = req.body;
    try {
        const updatedPromo = await pool.query(
            'UPDATE promotions SET title = $1, description = $2, image_url = $3, link_url = $4, is_active = $5 WHERE promo_id = $6 RETURNING *',
            [title, description, image_url, link_url, is_active, id]
        );
        if (updatedPromo.rowCount === 0) return res.status(404).json({ error: 'Promosi tidak ditemukan.' });
        res.json(updatedPromo.rows[0]);
    } catch (err) {
        console.error('[ADMIN] Error saat memperbarui promosi:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan server.' });
    }
});

// DELETE (Admin): Menghapus promosi
app.delete('/api/admin/promotions/:id', adminAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const deleteResult = await pool.query('DELETE FROM promotions WHERE promo_id = $1', [id]);
        if (deleteResult.rowCount === 0) return res.status(404).json({ error: 'Promosi tidak ditemukan.' });
        res.json({ message: 'Promosi berhasil dihapus.' });
    } catch (err) {
        console.error('[ADMIN] Error saat menghapus promosi:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan server.' });
    }
});

// --- ADMIN USERS ENDPOINTS ---

// GET (Admin): Mengambil semua pengguna terdaftar
app.get('/api/admin/users', adminAuthMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT user_id, full_name, email, created_at, rewards_balance FROM users ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[ADMIN] Error saat mengambil data pengguna:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// PUT (Admin): Memperbarui saldo rewards pengguna
app.put('/api/admin/users/:id/rewards',
    [
        adminAuthMiddleware,
        param('id', 'User ID harus valid').isInt(),
        body('rewards_balance', 'Saldo rewards harus angka non-negatif').isInt({ min: 0 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { rewards_balance } = req.body;

        try {
            const updateUser = await pool.query(
                'UPDATE users SET rewards_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 RETURNING user_id, full_name, rewards_balance',
                [rewards_balance, id]
            );

            if (updateUser.rowCount === 0) {
                return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
            }

            res.json({
                message: `Saldo rewards untuk ${updateUser.rows[0].full_name} berhasil diperbarui.`,
                user: updateUser.rows[0]
            });

        } catch (err) {
            console.error(`[ADMIN] Error saat memperbarui saldo rewards untuk user ID ${id}:`, err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

// GET (Admin): Mengambil detail dan riwayat transaksi satu pengguna
app.get('/api/admin/users/:id', adminAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        // Ambil data pengguna
        const userResult = await pool.query('SELECT user_id, full_name, email, created_at, rewards_balance FROM users WHERE user_id = $1', [id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
        const userData = userResult.rows[0];

        // Ambil riwayat transaksi pengguna tersebut
        const transactionsResult = await pool.query(`
            SELECT t.external_id, t.created_at, g.name AS game_name, p.name AS product_name, t.total_price, t.status
            FROM transactions t
            JOIN products p ON t.product_id = p.product_id
            JOIN games g ON p.game_id = g.game_id
            WHERE t.user_id = $1
            ORDER BY t.created_at DESC
        `, [id]);

        res.json({
            user: userData,
            transactions: transactionsResult.rows
        });

    } catch (err) {
        console.error(`[ADMIN] Error saat mengambil detail pengguna ID ${id}:`, err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// --- ADMIN TRANSACTIONS ENDPOINTS ---
app.get('/api/admin/transactions', adminAuthMiddleware, async (req, res) => {
    const { status } = req.query;
    let queryText = `
        SELECT 
            t.transaction_id, t.external_id, t.user_id, 
            COALESCE(u.email, t.email_for_guest) AS user_identifier, 
            g.name AS game_name, 
            p.name AS product_name, 
            t.quantity, t.total_price, t.status, 
            t.created_at, t.updated_at,
            t.rewards_earned, t.rewards_used
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.user_id
        JOIN products p ON t.product_id = p.product_id
        JOIN games g ON p.game_id = g.game_id
    `;
    const queryParams = [];
    if (status) {
        queryParams.push(status.toUpperCase());
        queryText += ` WHERE t.status = $${queryParams.length}`;
    }
    queryText += ' ORDER BY t.created_at DESC';
    try {
        const result = await pool.query(queryText, queryParams);
        const formattedTransactions = result.rows.map(tx => ({
            ...tx,
            created_at_formatted: new Date(tx.created_at).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short'}),
            updated_at_formatted: new Date(tx.updated_at).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short'}),
            total_price_formatted: `Rp ${parseInt(tx.total_price).toLocaleString('id-ID')}`,
            status_formatted: tx.status ? tx.status.charAt(0).toUpperCase() + tx.status.slice(1).toLowerCase() : 'N/A',
        }));
        res.json(formattedTransactions);
    } catch (err) {
        console.error('[ADMIN] Error saat mengambil semua transaksi:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// GET (Admin): Memeriksa transaksi baru sejak waktu tertentu
app.get('/api/admin/transactions/recent', adminAuthMiddleware, async (req, res) => {
    const { since } = req.query; // Waktu dalam format ISO string (UTC)

    if (!since) {
        return res.status(400).json({ error: 'Parameter "since" dibutuhkan.' });
    }

    try {
        // Konversi string ISO kembali ke objek Date
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
            return res.status(400).json({ error: 'Format tanggal "since" tidak valid.' });
        }

        const result = await pool.query(
            "SELECT external_id, total_price FROM transactions WHERE created_at > $1 ORDER BY created_at DESC",
            [sinceDate]
        );

        res.json(result.rows);

    } catch (err) {
        console.error('[ADMIN] Error saat memeriksa transaksi terbaru:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

app.put('/api/admin/transactions/:transactionId/status',
    [
        adminAuthMiddleware,
        param('transactionId', 'ID Transaksi harus UUID yang valid').isUUID(),
        body('newStatus', 'Status baru harus diisi').notEmpty().trim().escape(),
        body('newStatus', 'Status baru tidak valid').isIn(['SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'REFUNDED'])
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { transactionId } = req.params;
        const { newStatus } = req.body;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const updateResult = await client.query(
                'UPDATE transactions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE transaction_id = $2 RETURNING *',
                [newStatus.toUpperCase(), transactionId]
            );
            if (updateResult.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ errors: [{ msg: 'Transaksi tidak ditemukan untuk diupdate.' }] });
            }
            const updatedTransaction = updateResult.rows[0];
            if (updatedTransaction.status === 'SUCCESS' && updatedTransaction.user_id && !updatedTransaction.rewards_earned) {
                const totalPriceNum = parseFloat(updatedTransaction.total_price);
                const rewardsUsedInThisTx = parseFloat(updatedTransaction.rewards_used) || 0;
                const originalPriceForRewardCalculation = totalPriceNum + rewardsUsedInThisTx;
                if (originalPriceForRewardCalculation > 0) {
                    const rewardsEarned = Math.floor(originalPriceForRewardCalculation * 0.01);
                    if (rewardsEarned > 0) {
                        await client.query(
                            'UPDATE users SET rewards_balance = rewards_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                            [rewardsEarned, updatedTransaction.user_id]
                        );
                        await client.query(
                            'UPDATE transactions SET rewards_earned = $1 WHERE transaction_id = $2',
                            [rewardsEarned, updatedTransaction.transaction_id]
                        );
                        updatedTransaction.rewards_earned = rewardsEarned;
                    }
                }
            }
            await client.query('COMMIT');
            res.json({
                message: `Status transaksi ${updatedTransaction.external_id} berhasil diubah menjadi ${updatedTransaction.status}`,
                transaction: updatedTransaction
            });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`Error saat update status transaksi (ID: ${transactionId}):`, err.stack);
            if (!res.headersSent) {
                res.status(500).json({ errors: [{ msg: 'Terjadi kesalahan pada server saat update status transaksi.' }] });
            }
        } finally {
            client.release();
        }
    }
);

// --- ADMIN GAMES & PRODUCTS ENDPOINTS ---

// GET: Mengambil semua game untuk panel admin
app.get('/api/admin/games', adminAuthMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                g.game_id, 
                g.name, 
                g.slug,
                g.category,
                g.is_active,
                COUNT(p.product_id) AS product_count
            FROM games g
            LEFT JOIN products p ON g.game_id = p.game_id
            GROUP BY g.game_id
            ORDER BY g.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[ADMIN] Error saat mengambil data games:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// GET: Mengambil detail satu game untuk form edit
app.get('/api/admin/games/:id', adminAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const gameResult = await pool.query('SELECT * FROM games WHERE game_id = $1', [id]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game tidak ditemukan.' });
        }
        res.json(gameResult.rows[0]);
    } catch (err) {
        console.error(`[ADMIN] Error mengambil detail game ID ${id}:`, err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});


// POST: Membuat game baru
app.post('/api/admin/games', 
    [
        adminAuthMiddleware,
        body('name', 'Nama game harus diisi').notEmpty().trim(),
        body('slug', 'Slug harus diisi').notEmpty().trim(),
        body('category', 'Kategori harus valid').isIn(['populer', 'baru', 'webstore']),
        body('image_url', 'URL Gambar harus valid').isURL(),
        body('is_active', 'Status aktif harus boolean').isBoolean()
    ], 
    async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, slug, category, image_url, user_id_help, is_active } = req.body;
    try {
        const newGame = await pool.query(
            'INSERT INTO games (name, slug, category, image_url, user_id_help, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, slug, category, image_url, user_id_help, is_active]
        );
        res.status(201).json(newGame.rows[0]);
    } catch (err) {
        console.error('[ADMIN] Error saat membuat game baru:', err.stack);
        if (err.code === '23505') { // Error untuk unique violation (misal: slug sudah ada)
            return res.status(409).json({ error: `Game dengan slug '${slug}' sudah ada.` });
        }
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// PUT: Memperbarui game yang sudah ada
app.put('/api/admin/games/:id', 
    [
        adminAuthMiddleware,
        param('id', 'ID Game harus valid').isInt(),
        body('name', 'Nama game harus diisi').notEmpty().trim(),
        body('slug', 'Slug harus diisi').notEmpty().trim(),
        body('category', 'Kategori harus valid').isIn(['populer', 'baru', 'webstore']),
        body('image_url', 'URL Gambar harus valid').isURL(),
        body('is_active', 'Status aktif harus boolean').isBoolean()
    ],
    async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { id } = req.params;
    const { name, slug, category, image_url, user_id_help, is_active } = req.body;
    try {
        const updatedGame = await pool.query(
            `UPDATE games 
             SET name = $1, slug = $2, category = $3, image_url = $4, user_id_help = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
             WHERE game_id = $7 RETURNING *`,
            [name, slug, category, image_url, user_id_help, is_active, id]
        );
        if (updatedGame.rowCount === 0) {
            return res.status(404).json({ error: 'Game tidak ditemukan untuk diperbarui.' });
        }
        res.json(updatedGame.rows[0]);
    } catch (err) {
        console.error(`[ADMIN] Error saat memperbarui game ID ${id}:`, err.stack);
        if (err.code === '23505') {
            return res.status(409).json({ error: `Game dengan slug '${slug}' sudah ada.` });
        }
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// DELETE: Menghapus game
app.delete('/api/admin/games/:id',
    [
        adminAuthMiddleware,
        param('id', 'ID Game harus valid').isInt()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Hapus dulu semua produk yang terkait dengan game ini
            await client.query('DELETE FROM products WHERE game_id = $1', [id]);
            
            // Hapus juga ulasan yang terkait (jika ada)
            await client.query('DELETE FROM reviews WHERE game_id = $1', [id]);

            // Baru hapus game-nya
            const deleteResult = await client.query('DELETE FROM games WHERE game_id = $1', [id]);

            if (deleteResult.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Game tidak ditemukan untuk dihapus.' });
            }

            await client.query('COMMIT');
            res.json({ message: 'Game dan semua produk terkait berhasil dihapus.' });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`[ADMIN] Error saat menghapus game ID ${id}:`, err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server saat menghapus game.' });
        } finally {
            client.release();
        }
    }
);

// === ADMIN PRODUCTS (TURUNAN DARI GAME) ===

// GET: Mengambil semua produk untuk satu game
app.get('/api/admin/games/:gameId/products', adminAuthMiddleware, async (req, res) => {
    const { gameId } = req.params;
    try {
        const products = await pool.query(
            'SELECT * FROM products WHERE game_id = $1 ORDER BY price ASC',
            [gameId]
        );
        res.json(products.rows);
    } catch (err) {
        console.error(`[ADMIN] Error mengambil produk untuk game ID ${gameId}:`, err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// POST: Membuat produk baru untuk sebuah game
app.post('/api/admin/products', 
    [
        adminAuthMiddleware,
        body('game_id', 'Game ID harus valid').isInt(),
        body('name', 'Nama produk harus diisi').notEmpty().trim(),
        body('price', 'Harga harus angka').isNumeric(),
        body('is_active', 'Status aktif harus boolean').isBoolean()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { game_id, name, price, description, is_active } = req.body;
        try {
            const newProduct = await pool.query(
                'INSERT INTO products (game_id, name, price, description, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [game_id, name, price, description, is_active]
            );
            res.status(201).json(newProduct.rows[0]);
        } catch (err) {
            console.error('[ADMIN] Error saat membuat produk baru:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

// PUT: Memperbarui produk yang sudah ada
app.put('/api/admin/products/:productId',
    [
        adminAuthMiddleware,
        param('productId', 'Product ID harus valid').isInt(),
        body('name', 'Nama produk harus diisi').notEmpty().trim(),
        body('price', 'Harga harus angka').isNumeric(),
        body('is_active', 'Status aktif harus boolean').isBoolean()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { productId } = req.params;
        const { name, price, description, is_active } = req.body;
        try {
            const updatedProduct = await pool.query(
                'UPDATE products SET name = $1, price = $2, description = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP WHERE product_id = $5 RETURNING *',
                [name, price, description, is_active, productId]
            );
            if (updatedProduct.rowCount === 0) {
                return res.status(404).json({ error: 'Produk tidak ditemukan.' });
            }
            res.json(updatedProduct.rows[0]);
        } catch (err) {
            console.error(`[ADMIN] Error saat memperbarui produk ID ${productId}:`, err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

// DELETE: Menghapus produk
app.delete('/api/admin/products/:productId',
    [
        adminAuthMiddleware,
        param('productId', 'Product ID harus valid').isInt()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { productId } = req.params;
        try {
            const deleteResult = await pool.query('DELETE FROM products WHERE product_id = $1', [productId]);
            if (deleteResult.rowCount === 0) {
                return res.status(404).json({ error: 'Produk tidak ditemukan.' });
            }
            res.json({ message: 'Produk berhasil dihapus.' });
        } catch (err) {
            console.error(`[ADMIN] Error saat menghapus produk ID ${productId}:`, err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

// --- ADMIN LOGIN ENDPOINT (SUDAH DIPERBAIKI) ---
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // 1. Bandingkan username
        if (username !== ADMIN_USERNAME) {
            return res.status(401).json({ error: 'Username atau password salah' });
        }

        // 2. Bandingkan password yang di-input dengan hash menggunakan bcrypt
        const isMatch = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

        if (!isMatch) {
            return res.status(401).json({ error: 'Username atau password salah' });
        }

        // 3. Jika cocok, buat token JWT
        const payload = { user: { isAdmin: true, username: ADMIN_USERNAME } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
            if (err) throw err;
            res.json({ token });
        });

    } catch (error) {
        console.error('Error saat login admin:', error);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});


// --- LUPA PASSWORD ENDPOINTS ---
app.post('/api/auth/forgot-password', 
    [ body('email', 'Masukkan email yang valid').isEmail().normalizeEmail() ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: errors.array()[0].msg });
        }
        const { email } = req.body;

        try {
            const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userResult.rows.length === 0) {
                return res.json({ message: 'Jika email Anda terdaftar, Anda akan menerima tautan reset kata sandi.' });
            }
            const user = userResult.rows[0];

            const token = crypto.randomBytes(32).toString('hex');
            const tokenExpires = new Date(Date.now() + 3600000); // 1 jam

            await pool.query(
                'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE user_id = $3',
                [token, tokenExpires, user.user_id]
            );

            const resetUrl = `http://localhost:3000/reset_password.html?token=${token}`;
            const emailSubject = 'Reset Kata Sandi Akun DPStore Anda';
            const emailHTML = `
                <h1>Halo ${user.full_name},</h1>
                <p>Anda menerima email ini karena Anda (atau orang lain) telah meminta untuk mereset kata sandi akun DPStore Anda.</p>
                <p>Silakan klik tautan di bawah ini untuk menyelesaikan prosesnya dalam waktu satu jam:</p>
                <p><a href="${resetUrl}" style="color: #eab308; text-decoration: none; font-weight: bold;">Reset Kata Sandi Anda</a></p>
                <p>Jika Anda tidak meminta ini, abaikan saja email ini.</p>
                <br><p>Salam,</p><p>Tim DPStore</p>
            `;

            await sendEmailNotification(user.email, emailSubject, emailHTML);

            res.json({ message: 'Jika email Anda terdaftar, Anda akan menerima tautan reset kata sandi.' });

        } catch (err) {
            console.error('Error di /forgot-password:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

app.post('/api/auth/reset-password/:token',
    [ 
        param('token').isHexadecimal().isLength({ min: 64, max: 64 }),
        body('password', 'Password baru minimal harus 8 karakter').isLength({ min: 8 }) 
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Token tidak valid atau password terlalu pendek.' });
        }
        const { token } = req.params;
        const { password } = req.body;

        try {
            const userResult = await pool.query(
                'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
                [token]
            );

            if (userResult.rows.length === 0) {
                return res.status(400).json({ error: 'Token reset kata sandi tidak valid atau telah kedaluwarsa.' });
            }
            const user = userResult.rows[0];

            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);

            await pool.query(
                'UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [passwordHash, user.user_id]
            );

            res.json({ message: 'Kata sandi Anda telah berhasil direset.' });

            // ---> TAMBAHKAN BLOK INI <---
            const emailSubject = 'Kata Sandi DPStore Anda Telah Diubah';
            const emailHTML = `<p>Halo ${user.full_name},</p><p>Ini adalah konfirmasi bahwa kata sandi untuk akun Anda telah berhasil diubah. Jika Anda tidak melakukan perubahan ini, segera hubungi dukungan kami.</p>`;
            sendEmailNotification(user.email, emailSubject, emailHTML).catch(err => console.error("Gagal mengirim email notifikasi reset password:", err));

        } catch (err) {
            console.error('Error di /reset-password:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

// POST: Endpoint untuk validasi User ID Game
app.post('/api/validate-user-id', async (req, res) => {
    const { gameSlug, userId, zoneId } = req.body;
    console.log(`[VALIDATE_ID] Menerima permintaan untuk game: ${gameSlug}, userId: ${userId}, zoneId: ${zoneId}`);

    if (!gameSlug || !userId) {
        return res.status(400).json({ error: 'Parameter gameSlug dan userId dibutuhkan.' });
    }

    const merchantId = process.env.APIGAMES_MERCHANT_ID;
    const secretKey = process.env.APIGAMES_SECRET_KEY;

    if (!merchantId || !secretKey) {
        console.error("Kesalahan Konfigurasi: Kredensial ApiGames tidak ditemukan di file .env");
        return res.status(500).json({ error: 'Konfigurasi server tidak lengkap.' });
    }
    
    const gameCodeMap = {
        'mobile-legends': 'mobilelegend',
        'free-fire': 'freefire',
    };
    const gameCode = gameCodeMap[gameSlug];

    if (!gameCode) {
        console.log(`[VALIDATE_ID] Game slug "${gameSlug}" tidak memerlukan validasi eksternal. Melewati.`);
        return res.json({ nickname: `Player: ${userId}` });
    }

    let requestUserId = userId.trim();
    if (gameCode === 'mobilelegend') {
        if (!zoneId || zoneId.trim() === '') {
            return res.status(400).json({ error: 'Zone ID dibutuhkan untuk Mobile Legends.' });
        }
        requestUserId = `${userId.trim()}(${zoneId.trim()})`;
    }

    // --- PERUBAHAN KUNCI ADA DI SINI ---
    // Signature sekarang menyertakan Merchant ID, User ID, dan Secret Key
    const signatureString = `${merchantId}${secretKey}${requestUserId}`;
    const signature = crypto.createHash('md5').update(signatureString).digest('hex');

    const apiUrl = `https://v1.apigames.id/merchant/${merchantId}/cek-username/${gameCode}?user_id=${encodeURIComponent(requestUserId)}&signature=${signature}`;
    
    console.log(`[VALIDATE_ID] String untuk signature: ${signatureString}`);
    console.log(`[VALIDATE_ID] Memanggil URL ApiGames: ${apiUrl}`);

    try {
        const response = await axios.get(apiUrl);

        // Memeriksa lebih banyak kemungkinan format error dari API
        if (response.data && response.data.status === 1 && response.data.data && response.data.data.is_valid) {
            console.log(`[VALIDATE_ID] Sukses dari ApiGames:`, response.data.data);
            res.json({ nickname: response.data.data.username });
        } else {
            const errorMessage = response.data.error_msg || response.data.message || 'Nickname tidak ditemukan atau User ID tidak valid.';
            console.warn(`[VALIDATE_ID] Gagal dari ApiGames:`, response.data);
            throw new Error(errorMessage);
        }

    } catch (error) {
        // Log yang lebih detail saat terjadi error
        const errorMessageFromServer = error.response ? (error.response.data.error_msg || error.response.data.message) : error.message;
        console.error(`[VALIDATE_ID] Error memanggil ApiGames untuk ${requestUserId}:`, errorMessageFromServer || "Tidak ada detail error dari server API");
        res.status(404).json({ error: errorMessageFromServer || 'User ID tidak ditemukan atau terjadi kesalahan.' });
    }
});

app.listen(port, () => {
    console.log(`Server backend dan frontend berjalan di http://localhost:${port}`);
    console.log(`Frontend Anda (dari folder '${path.basename(frontendPath)}') disajikan. Coba akses halaman utama di http://localhost:${port}/index.html`);
});