const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia-super-duper-aman-milik-dpstore';

module.exports = function(req, res, next) {
    // Ambil token dari header 'Authorization'
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return res.status(401).json({ error: 'Akses ditolak. Token tidak ada.' });
    }

    const tokenParts = authHeader.split(' ');
    if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Format token salah. Harus "Bearer [token]".' });
    }

    const token = tokenParts[1];

    try {
        // Verifikasi token
        const decoded = jwt.verify(token, JWT_SECRET);
        // Pastikan token ini adalah token admin
        if (decoded.user && decoded.user.isAdmin) {
            req.user = decoded.user; // Simpan info admin di request
            next(); // Lanjutkan ke endpoint yang dituju
        } else {
            throw new Error('Token tidak valid untuk admin.');
        }
    } catch (err) {
        res.status(401).json({ error: 'Token tidak valid atau sudah kedaluwarsa.' });
    }
};