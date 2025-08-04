// File: Project/dpstore-backend/routes/adminRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

// KODE LAMA DIHAPUS: const pool = new Pool(...)

// Bungkus semua rute dalam sebuah fungsi yang menerima 'pool'
module.exports = function(pool) {
    const router = express.Router();
    const JWT_SECRET = process.env.JWT_SECRET;

    // Rute login admin tidak memerlukan middleware
    router.post('/login', async (req, res) => {
        const { username, password } = req.body;
        const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
        const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

        try {
            if (username !== ADMIN_USERNAME) {
                return res.status(401).json({ error: 'Username atau password salah' });
            }
            const isMatch = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
            if (!isMatch) {
                return res.status(401).json({ error: 'Username atau password salah' });
            }
            const payload = { user: { isAdmin: true, username: ADMIN_USERNAME } };
            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
            res.json({ token });
        } catch (error) {
            console.error('Error saat login admin:', error);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    });

    // Gunakan middleware untuk semua rute di bawah ini
    router.use(adminAuthMiddleware);

    // === RUTE-RUTE ADMIN ===

    router.get('/dashboard-stats', async (req, res) => {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const incomeTodayResult = await pool.query("SELECT SUM(total_price) as total FROM transactions WHERE status = 'SUCCESS' AND created_at >= $1", [todayStart]);
            const transactionsTodayResult = await pool.query("SELECT COUNT(transaction_id) as count FROM transactions WHERE created_at >= $1", [todayStart]);
            const newUsersTodayResult = await pool.query("SELECT COUNT(user_id) as count FROM users WHERE created_at >= $1", [todayStart]);
            
            const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
            const transactionsThisMonthResult = await pool.query("SELECT COUNT(transaction_id) as count FROM transactions WHERE created_at >= $1", [monthStart]);

            res.json({
                incomeToday: incomeTodayResult.rows[0].total || 0,
                transactionsToday: transactionsTodayResult.rows[0].count || 0,
                newUsersToday: newUsersTodayResult.rows[0].count || 0,
                transactionsThisMonth: transactionsThisMonthResult.rows[0].count || 0
            });
        } catch (err) {
            console.error('[ADMIN] Error saat mengambil statistik dashboard:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    });

// --- Rute Promosi ---
router.get('/promotions', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM promotions ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('[ADMIN] Error saat mengambil promosi:', err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.post('/promotions', [
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

router.put('/promotions/:id', [
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

router.delete('/promotions/:id', async (req, res) => {
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

// --- Rute Pengguna ---
router.get('/users', async (req, res) => {
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

router.put('/users/:id/rewards', [
    param('id').isInt(),
    body('rewards_balance').isInt({ min: 0 })
], async (req, res) => {
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
});

router.get('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const userResult = await pool.query('SELECT user_id, full_name, email, created_at, rewards_balance FROM users WHERE user_id = $1', [id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
        const userData = userResult.rows[0];
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

// --- Rute Transaksi ---
router.get('/transactions', async (req, res) => {
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

router.get('/transactions/recent', async (req, res) => {
    const { since } = req.query;
    if (!since) {
        return res.status(400).json({ error: 'Parameter "since" dibutuhkan.' });
    }
    try {
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

router.put('/transactions/:transactionId/status', [
    param('transactionId').isUUID(),
    body('newStatus').isIn(['SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'REFUNDED'])
], async (req, res) => {
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
            return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
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
                        'UPDATE users SET rewards_balance = rewards_balance + $1 WHERE user_id = $2',
                        [rewardsEarned, updatedTransaction.user_id]
                    );
                    await client.query(
                        'UPDATE transactions SET rewards_earned = $1 WHERE transaction_id = $2',
                        [rewardsEarned, updatedTransaction.transaction_id]
                    );
                }
            }
        }
        await client.query('COMMIT');
        res.json({
            message: `Status transaksi berhasil diubah menjadi ${newStatus}`,
            transaction: updatedTransaction
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error saat update status transaksi (ID: ${transactionId}):`, err.stack);
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    } finally {
        client.release();
    }
});

// --- Rute Game & Produk ---
router.get('/games', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                g.game_id, g.name, g.slug, g.category, g.is_active,
                COUNT(p.product_id) AS product_count
            FROM games g
            LEFT JOIN products p ON g.game_id = p.game_id
            GROUP BY g.game_id
            ORDER BY g.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// Rute untuk mendapatkan detail game by ID <-- TAMBAHKAN BARIS INI
router.get('/games/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const gameResult = await pool.query('SELECT * FROM games WHERE game_id = $1', [id]);
        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game tidak ditemukan.' });
        }
        res.json(gameResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.post('/games', [
    body('name').notEmpty().trim(),
    body('slug').notEmpty().trim().isSlug(),
    body('category').isIn(['populer', 'baru', 'webstore']),
    body('image_url').isURL(),
    body('is_active').isBoolean(),
    body('user_id_help').optional().trim().isLength({ max: 500 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    const { name, slug, category, image_url, user_id_help, is_active } = req.body;
    try {
        const newGame = await pool.query(
            'INSERT INTO games (name, slug, category, image_url, user_id_help, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, slug, category, image_url, user_id_help, is_active]
        );
        res.status(201).json(newGame.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: `Game dengan slug '${slug}' sudah ada.` });
        }
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.put('/games/:id', [
    param('id').isInt(),
    body('name').notEmpty().trim(),
    body('slug').notEmpty().trim().isSlug(),
    body('category').isIn(['populer', 'baru', 'webstore']),
    body('image_url').isURL(),
    body('is_active').isBoolean(),
    body('user_id_help').optional().trim().isLength({ max: 500 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    const { id } = req.params;
    const { name, slug, category, image_url, user_id_help, is_active } = req.body;
    try {
        const updatedGame = await pool.query(
            `UPDATE games SET name = $1, slug = $2, category = $3, image_url = $4, user_id_help = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP WHERE game_id = $7 RETURNING *`,
            [name, slug, category, image_url, user_id_help, is_active, id]
        );
        if (updatedGame.rowCount === 0) {
            return res.status(404).json({ error: 'Game tidak ditemukan.' });
        }
        res.json(updatedGame.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: `Game dengan slug '${slug}' sudah ada.` });
        }
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.delete('/games/:id', [param('id').isInt()], async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM products WHERE game_id = $1', [id]);
        await client.query('DELETE FROM reviews WHERE game_id = $1', [id]);
        const deleteResult = await client.query('DELETE FROM games WHERE game_id = $1', [id]);
        if (deleteResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Game tidak ditemukan.' });
        }
        await client.query('COMMIT');
        res.json({ message: 'Game dan semua produk terkait berhasil dihapus.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    } finally {
        client.release();
    }
});

router.get('/games/:gameId/products', async (req, res) => {
    const { gameId } = req.params;
    try {
        const products = await pool.query('SELECT * FROM products WHERE game_id = $1 ORDER BY price ASC', [gameId]);
        res.json(products.rows);
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.post('/products', [
    body('game_id').isInt(),
    body('name').notEmpty().trim(),
    body('price').isNumeric(),
    body('is_active').isBoolean()
], async (req, res) => {
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
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.put('/products/:productId', [
    param('productId').isInt(),
    body('name').notEmpty().trim(),
    body('price').isNumeric(),
    body('is_active').isBoolean()
], async (req, res) => {
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
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

router.delete('/products/:productId', [param('productId').isInt()], async (req, res) => {
    const { productId } = req.params;
    try {
        const deleteResult = await pool.query('DELETE FROM products WHERE product_id = $1', [productId]);
        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ error: 'Produk tidak ditemukan.' });
        }
        res.json({ message: 'Produk berhasil dihapus.' });
    } catch (err) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// KEMBALIKAN ROUTER DI AKHIR FUNGSI
    return router;
};