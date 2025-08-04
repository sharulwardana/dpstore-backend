// File: Project/dpstore-backend/routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { body, param, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');

// KODE LAMA DIHAPUS: const pool = new Pool(...)

// Bungkus semua rute dalam sebuah fungsi yang menerima 'pool'
module.exports = function(pool) {
    const router = express.Router();
    const JWT_SECRET = process.env.JWT_SECRET;

    // --- Fungsi Helper Pengiriman Email --- (Kode ini tetap sama)
    const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
async function sendEmailNotification(to, subject, htmlContent) {
    try {
        await transporter.sendMail({
            from: '"DPStore Notifikasi" <herualfatih36@gmail.com>',
            to, subject, html: htmlContent
        });
        console.log('Email notifikasi terkirim ke %s', to);
    } catch (error) {
        console.error('Gagal mengirim email notifikasi ke %s:', to, error);
    }
}

// Middleware untuk memastikan pengguna sudah login
const requireLogin = (req, res, next) => {
    if ((req.user && req.user.id) || req.isAuthenticated()) {
        if (req.isAuthenticated() && !req.user) {
            req.user = { id: req.session.passport.user };
        }
        return next();
    }
    return res.status(401).json({ error: 'Akses ditolak. Anda harus login.' });
};


// === RUTE-RUTE AUTENTIKASI & PENGGUNA ===

router.post('/register',
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
                return res.status(409).json({ error: 'Email sudah terdaftar.' });
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
            const emailHTML = `<h1>Halo ${newUser.full_name},</h1><p>Terima kasih telah mendaftar di DPStore! Akun Anda telah berhasil dibuat.</p>`;
            sendEmailNotification(newUser.email, emailSubject, emailHTML);
        } catch (err) {
            console.error('Error saat registrasi:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

router.post('/login',
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
                return res.status(401).json({ error: 'Email atau password salah.' });
            }
            const user = userResult.rows[0];
            if (!user.password_hash) {
                 return res.status(401).json({ error: 'Akun ini terdaftar via Google. Silakan masuk dengan Google.' });
            }
            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (!isMatch) {
                return res.status(401).json({ error: 'Email atau password salah.' });
            }
            const payload = { user: { id: user.user_id, email: user.email, fullName: user.full_name } };
            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
            res.json({ message: 'Login berhasil!', token, user: payload.user });
        } catch (err) {
            console.error('Error saat login:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

router.get('/session-token', (req, res) => {
    if (req.isAuthenticated()) {
        const user = req.user;
        const payload = { user: { id: user.user_id, email: user.email, fullName: user.full_name } };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, user: payload.user });
    } else {
        res.status(401).json({ error: 'Tidak ada sesi aktif.' });
    }
});

router.get('/me', authMiddleware, requireLogin, async (req, res) => {
    try {
        const userId = req.user.id;
        const userResult = await pool.query('SELECT user_id, email, full_name, rewards_balance, created_at FROM users WHERE user_id = $1', [userId]);
        if (userResult.rows.length > 0) {
            const userData = userResult.rows[0];
            userData.rewards_balance_formatted = `Rp ${parseInt(userData.rewards_balance || 0).toLocaleString('id-ID')}`;
            res.json(userData);
        } else {
            res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
    } catch(err) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/me', authMiddleware, requireLogin,
    [ body('fullName', 'Nama lengkap minimal 3 karakter').isLength({ min: 3 }).trim().escape() ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        
        const { fullName } = req.body;
        const userId = req.user.id;

        try {
            const updateUser = await pool.query(
                'UPDATE users SET full_name = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 RETURNING user_id, email, full_name',
                [fullName, userId]
            );
            if (updateUser.rowCount === 0) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
            
            res.json({
                message: 'Profil berhasil diperbarui!',
                user: { id: updateUser.rows[0].user_id, email: updateUser.rows[0].email, fullName: updateUser.rows[0].full_name }
            });
        } catch (err) {
            console.error('[AUTH] Error saat memperbarui profil:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

router.put('/change-password', authMiddleware, requireLogin,
    [
        body('oldPassword', 'Password lama harus diisi').notEmpty(),
        body('newPassword', 'Password baru minimal harus 8 karakter').isLength({ min: 8 }),
        body('confirmNewPassword', 'Konfirmasi password tidak cocok').custom((value, { req }) => value === req.body.newPassword)
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        
        const { oldPassword, newPassword } = req.body;
        const userId = req.user.id;

        try {
            const userResult = await pool.query('SELECT password_hash, full_name, email FROM users WHERE user_id = $1', [userId]);
            if (userResult.rows.length === 0) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
            
            const user = userResult.rows[0];
            if (!user.password_hash) return res.status(400).json({ error: 'Ubah password tidak berlaku untuk akun Google.' });

            const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
            if (!isMatch) return res.status(401).json({ error: 'Password lama Anda salah.' });

            const salt = await bcrypt.genSalt(10);
            const newPasswordHash = await bcrypt.hash(newPassword, salt);
            await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [newPasswordHash, userId]);
            
            res.json({ message: 'Password berhasil diubah.' });
            sendEmailNotification(user.email, 'Password DPStore Anda Telah Diubah', `<p>Halo ${user.full_name}, password Anda berhasil diubah. Jika ini bukan Anda, segera hubungi kami.</p>`);
        } catch (err) {
            console.error('Error saat mengubah password:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

router.post('/forgot-password', 
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
            
            const token = crypto.randomBytes(32).toString('hex')
            const tokenExpires = new Date(Date.now() + 3600000); // 1 jam
            
            await pool.query(
                'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE user_id = $3',
                [token, tokenExpires, user.user_id]
            );
            
            const resetUrl = `${process.env.FRONTEND_URL}/reset_password.html?token=${token}`; // Menggunakan variabel dari .env
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

router.post('/reset-password/:token',
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
            
            const emailSubject = 'Kata Sandi DPStore Anda Telah Diubah';
            const emailHTML = `<p>Halo ${user.full_name},</p><p>Ini adalah konfirmasi bahwa kata sandi untuk akun Anda telah berhasil diubah. Jika Anda tidak melakukan perubahan ini, segera hubungi dukungan kami.</p>`;
            sendEmailNotification(user.email, emailSubject, emailHTML).catch(err => console.error("Gagal mengirim email notifikasi reset password:", err));
        
        } catch (err) {
            console.error('Error di /reset-password:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    }
);

router.get('/favorites/me', authMiddleware, requireLogin, async (req, res) => {
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
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.post('/favorites', authMiddleware, requireLogin, [body('gameId').isInt()], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    
    const { gameId } = req.body;
    const userId = req.user.id;
    try {
        await pool.query('INSERT INTO user_favorites (user_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, gameId]);
        res.status(201).json({ message: 'Game ditambahkan ke favorit.' });
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.delete('/favorites/:gameId', authMiddleware, requireLogin, [param('gameId').isInt()], async (req, res) => {
    const { gameId } = req.params;
    const userId = req.user.id;
    try {
        const result = await pool.query('DELETE FROM user_favorites WHERE user_id = $1 AND game_id = $2', [userId, gameId]);
        if (result.rowCount > 0) {
            res.json({ message: 'Game dihapus dari favorit.' });
        } else {
            res.status(404).json({ error: 'Game tidak ditemukan di favorit.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.get('/transactions/me', authMiddleware, requireLogin, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await pool.query(
            `SELECT t.*, g.name as game_name, g.slug as game_slug, p.name as product_name 
             FROM transactions t
             JOIN products p ON t.product_id = p.product_id
             JOIN games g ON p.game_id = g.game_id
             WHERE t.user_id = $1 ORDER BY t.created_at DESC`, [userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// KEMBALIKAN ROUTER DI AKHIR FUNGSI
    return router;
};