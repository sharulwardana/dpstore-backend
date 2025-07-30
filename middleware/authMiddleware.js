const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia-super-duper-aman-milik-dpstore'; // Samakan dengan di server.js

module.exports = function(req, res, next) {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        // Tidak ada token, lanjutkan. req.user akan undefined.
        // Endpoint akan memeriksa req.user jika otentikasi diperlukan.
        return next();
    }

    const tokenParts = authHeader.split(' ');
    if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
        console.warn('[AUTH_MIDDLEWARE] Format token tidak valid diterima:', authHeader);
        // Format token salah, lanjutkan. req.user akan undefined.
        return next();
    }

    const token = tokenParts[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded.user; // Tambahkan user ke request jika token valid
        console.log('[AUTH_MIDDLEWARE] Token valid, req.user di-set:', req.user);
    } catch (err) {
        // Token ada tapi tidak valid (kadaluwarsa, salah, dll.)
        console.warn('[AUTH_MIDDLEWARE] Token tidak valid atau kadaluarsa:', err.message);
        // Biarkan req.user undefined, jangan kirim respons error dari sini.
    }
    next(); // Selalu panggil next() untuk melanjutkan ke handler berikutnya
};