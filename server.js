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
const cors = require('cors'); // Make sure 'cors' is imported
const { Pool } = require('pg');

const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const port = process.env.PORT || 3000;

// This is crucial for Express to trust the proxy on Railway
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

// --- Final CORS Configuration ---
const allowedOrigins = [
    'https://zingy-zabaione-a27ed6.netlify.app',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests if the origin is in our whitelist, or if there's no origin (e.g., server-to-server, Postman)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('This origin is not allowed by CORS'));
        }
    },
    credentials: true,
};

// Use the cors middleware with our options
app.use(cors(corsOptions));
// Explicitly handle pre-flight (OPTIONS) requests
app.options('*', cors(corsOptions));


// --- Other Middleware ---
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