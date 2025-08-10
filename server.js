// File: Project/dpstore-backend/server.js [DEBUG VERSION]

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

console.log("--- Starting Server in DEBUG MODE ---");

// Cek variabel environment penting
if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    console.error("FATAL ERROR: Environment variables are not configured correctly in Railway.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const publicRoutes = require('./routes/publicRoutes')(pool);
const authRoutes = require('./routes/authRoutes')(pool);
const adminRoutes = require('./routes/adminRoutes')(pool);

async function startServer() {
    // 1. Tes koneksi database
    try {
        const client = await pool.connect();
        console.log('✅ Database connection successful.');
        client.release();
    } catch (dbError) {
        console.error('❌ Could not connect to the database. Shutting down.', dbError);
        process.exit(1);
    }

    // 2. Jalankan server Express
    const app = express();
    const port = process.env.PORT || 3000;
    const HOST = '0.0.0.0';

    app.set('trust proxy', 1);

    // --- MIDDLEWARE SEMENTARA DINONAKTIFKAN ---
    // const cors = require('cors');
    // const session = require('express-session');
    // const PgStore = require('connect-pg-simple')(session);

    app.use(express.json()); // Hanya ini yang kita aktifkan

    // --- Rute API ---
    // Rute healthcheck sederhana untuk Railway
    app.get('/health', (req, res) => {
        console.log("Health check endpoint was hit.");
        res.status(200).send('Server is healthy!');
    });
    
    // Kita tetap mendaftarkan rute, tapi mungkin tidak akan bisa diakses karena CORS nonaktif
    app.use('/api', publicRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/admin', adminRoutes);
    
    // Global Error Handler
    app.use((err, req, res, next) => {
        console.error('GLOBAL ERROR HANDLER CAUGHT AN ERROR:', err.stack);
        res.status(500).json({ error: 'Something went terribly wrong!' });
    });

    app.listen(port, HOST, () => {
        console.log(`🚀 Server is LIVE and running on http://${HOST}:${port}`);
        console.log("Now waiting to see if it stays running...");
    });
}

startServer();