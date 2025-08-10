// File: Project/dpstore-backend/server.js [ISOLATION MODE]

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

console.log("--- Starting Server in ISOLATION MODE ---");

if (!process.env.DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL is not defined.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Kita tetap memuat file-file ini untuk memastikan tidak ada error saat require()
console.log("Requiring route files...");
const publicRoutes = require('./routes/publicRoutes')(pool);
const authRoutes = require('./routes/authRoutes')(pool);
const adminRoutes = require('./routes/adminRoutes')(pool);
console.log("Route files required successfully.");


async function startServer() {
    try {
        const client = await pool.connect();
        console.log('✅ Database connection successful.');
        client.release();
    } catch (dbError) {
        console.error('❌ Could not connect to the database. Shutting down.', dbError);
        process.exit(1);
    }

    const app = express();
    const port = process.env.PORT || 3000;
    const HOST = '0.0.0.0';

    // Rute healthcheck sederhana
    app.get('/health', (req, res) => {
        console.log("Health check endpoint was hit. Server should stay alive now.");
        res.status(200).send('Server is healthy and isolated!');
    });
    
    // --- RUTE API SENGAJA DINONAKTIFKAN ---
    // console.log("Registering API routes is SKIPPED in isolation mode.");
    // app.use('/api', publicRoutes);
    // app.use('/api/auth', authRoutes);
    // app.use('/api/admin', adminRoutes);
    
    app.listen(port, HOST, () => {
        console.log(`🚀 Server is LIVE and running on http://${HOST}:${port}`);
        console.log("Waiting to see if the container stops...");
    });
}

startServer();