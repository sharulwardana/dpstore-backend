// File: Project/dpstore-backend/server.js

// Global Error Handling
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', err);
    process.exit(1);
});
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
    process.exit(1);
});

require('dotenv').config();

const express = require('express');
const cors = require('cors'); // Pastikan 'cors' di-import
const { Pool } = require('pg');

const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const port = process.env.PORT || 3000;

// Tetap aktifkan ini, sangat penting untuk lingkungan di belakang proxy
app.set('trust proxy', 1);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

async function testDbConnection() {
    let client;
    try {
        client = await pool.connect();
        console.log('✅ Database connection successful.');
    } catch (err) {
        console.error('❌ Database connection failed:', err.stack);
        process.exit(1);
    } finally {
        if (client) client.release();
    }
}
testDbConnection();

// --- Konfigurasi CORS Baru dan Final ---
const allowedOrigins = [
    'https://zingy-zabaione-a27ed6.netlify.app',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
];

const corsOptions = {
    origin: (origin, callback) => {
        // Log untuk debugging
        console.log(`Request from origin: ${origin}`);
        
        // Izinkan jika origin ada di dalam daftar, atau jika request tidak memiliki origin (misal: dari Postman, curl)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('This origin is not allowed by CORS'));
        }
    },
    credentials: true, // Izinkan pengiriman cookie
};

// Gunakan middleware cors dengan konfigurasi di atas
app.use(cors(corsOptions));
// Pastikan pre-flight requests (OPTIONS) juga ditangani
app.options('*', cors(corsOptions));


// --- Middleware Lainnya ---
app.use(express.json());


// --- API Routes ---
app.get('/health', (req, res) => res.status(200).send('Server is healthy!'));
app.use('/api', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);


// --- Global Error Handler ---
app.use((err, req, res, next) => {
    console.error('Global Error Handler:', err.stack);
    res.status(500).json({ error: 'Something went wrong on the server!' });
});

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});