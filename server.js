// File: Project/dpstore-backend/server.js

// ... (Global Error Handling tetap sama)

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const port = process.env.PORT || 3000;

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

// --- CORS Configuration ---
const allowedOrigins = [
    'https://zingy-zabaione-a27ed6.netlify.app',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
];

const corsOptions = {
    origin: (origin, callback) => {
        // Log setiap origin yang mencoba mengakses
        console.log(`Incoming request from origin: ${origin}`);
        if (!origin || allowedOrigins.includes(origin)) {
            console.log(`CORS check passed for origin: ${origin}`);
            callback(null, true);
        } else {
            console.error(`CORS check FAILED for origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

// --- Middleware ---
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
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