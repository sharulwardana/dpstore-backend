// File: Project/dpstore-backend/server.js

// Global Error Handling (Good Practice!)
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message, err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message, err.stack);
    process.exit(1);
});

// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// Import your route files
const publicRoutes = require('./routes/publicRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const port = process.env.PORT || 3000;

// --- Database Connection Pool ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    // Optional: Add pool configuration for better performance
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// --- Test Database Connection on Startup ---
async function testDbConnection() {
    let client;
    try {
        client = await pool.connect();
        console.log('✅ Database connection successful.');
    } catch (err) {
        console.error('❌ Database connection failed:', err.stack);
        process.exit(1); // Exit if DB connection fails
    } finally {
        if (client) client.release();
    }
}
testDbConnection();

// --- CORS Configuration ---
// Make sure your Netlify URL is correct and does not have a trailing slash
const allowedOrigins = [
    'https://zingy-zabaione-a27ed6.netlify.app',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, // If you need to handle cookies or authorization headers
    optionsSuccessStatus: 200
};

// --- Middleware ---
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Enable pre-flight for all routes
app.use(express.json()); // Middleware to parse JSON bodies

// --- API Routes ---
app.get('/health', (req, res) => res.status(200).send('Server is healthy!'));
app.use('/api', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// --- Global Error Handler Middleware (Must be the last app.use call) ---
app.use((err, req, res, next) => {
    console.error('Global Error Handler:', err.stack);
    res.status(500).json({ error: 'Something went wrong on the server!' });
});

// --- Start the Server ---
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});