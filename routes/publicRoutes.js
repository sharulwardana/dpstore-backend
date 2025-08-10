// File: Project/dpstore-backend/routes/publicRoutes.js

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');

// This function will now wrap your entire router
module.exports = function(pool) {
    const router = express.Router();

    // --- Helper Functions (No Change) ---
    const nodemailer = require('nodemailer');
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

    // === RUTE-RUTE PUBLIK DENGAN LOGGING BARU ===
    router.get('/games', async (req, res) => {
        const queryText = 'SELECT game_id, name, slug, image_url, category, header_promo_text, created_at FROM games WHERE is_active = TRUE ORDER BY created_at DESC';
        console.log(`[DEBUG] Executing query for /games: ${queryText}`);
        try {
            const result = await pool.query(queryText);
            res.json(result.rows);
        } catch (err) {
            console.error('[ERROR] in /games route:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server saat mengambil games' });
        }
    });

    router.get('/promotions', async (req, res) => {
        const queryText = 'SELECT * FROM promotions WHERE is_active = TRUE ORDER BY created_at DESC';
        console.log(`[DEBUG] Executing query for /promotions: ${queryText}`);
        try {
            const result = await pool.query(queryText);
            res.json(result.rows);
        } catch (err) {
            console.error('[ERROR] in /promotions route:', err.stack);
            res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
        }
    });

    // ... (Salin sisa rute Anda dari file asli ke sini. Kode di bawah ini adalah placeholder) ...
    
    router.get('/games/search', async (req, res) => {
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

router.get('/games/:slug', async (req, res) => {
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

router.get('/reviews/:game_slug', async (req, res) => {
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

router.get('/testimonials', async (req, res) => {
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

router.get('/payment-methods', (req, res) => {
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

router.post('/validate-user-id', async (req, res) => {
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
        'mobile-legends': 'mobilelegends',
        'free-fire': 'freefire',
    };
    const gameCode = gameCodeMap[gameSlug];

    if (!gameCode) {
        console.log(`[VALIDATE_ID] Game slug "${gameSlug}" tidak memerlukan validasi eksternal. Melewati.`);
        return res.json({ nickname: `Player: ${userId}` });
    }

    let requestUserId = userId.trim();
    if (gameCode === 'mobilelegends') {
        if (!zoneId || zoneId.trim() === '') {
            return res.status(400).json({ error: 'Zone ID dibutuhkan untuk Mobile Legends.' });
        }
        requestUserId = `${userId.trim()}(${zoneId.trim()})`;
    }

    const signatureString = `${merchantId}:${secretKey}`;
    const signature = crypto.createHash('md5').update(signatureString).digest('hex');

    const apiUrl = `https://v1.apigames.id/merchant/${merchantId}/cek-username/${gameCode}?user_id=${encodeURIComponent(requestUserId)}&signature=${signature}`;
    
    console.log(`[VALIDATE_ID] String untuk signature: ${signatureString}`);
    console.log(`[VALIDATE_ID] Memanggil URL ApiGames: ${apiUrl}`);

    try {
        const response = await axios.get(apiUrl);

        if (response.data && response.data.status === 1 && response.data.data && response.data.data.is_valid) {
            console.log(`[VALIDATE_ID] Sukses dari ApiGames:`, response.data.data);
            res.json({ nickname: response.data.data.username });
        } else {
            const errorMessage = response.data.error_msg || response.data.message || 'Nickname tidak ditemukan atau User ID tidak valid.';
            console.warn(`[VALIDATE_ID] Gagal dari ApiGames:`, response.data);
            throw new Error(errorMessage);
        }

    } catch (error) {
        const errorMessageFromServer = error.response ? (error.response.data.error_msg || error.response.data.message) : error.message;
        console.error(`[VALIDATE_ID] Error memanggil ApiGames untuk ${requestUserId}:`, errorMessageFromServer || "Tidak ada detail error dari server API");
        res.status(404).json({ error: errorMessageFromServer || 'User ID tidak ditemukan atau terjadi kesalahan.' });
    }
});

router.get('/transactions/check/:externalId', async (req, res) => {
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

router.post('/transactions',
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
    
    return router;
}