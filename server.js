// File: Project/dpstore-backend/server.js [VERSI NORMAL]

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
const cors = require('cors');
const { Pool } = require('pg');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);

// --- Create a SINGLE Database Pool ---
if (!process.env.DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL is not defined.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Import route files
const publicRoutes = require('./routes/publicRoutes')(pool);
const authRoutes = require('./routes/authRoutes')(pool);
const adminRoutes = require('./routes/adminRoutes')(pool);

async function testDbConnection(retries = 5) {
    while (retries > 0) {
        let client;
        try {
            console.log('Attempting to connect to the database...');
            client = await pool.connect();
            console.log('✅ Database connection successful.');
            if (client) client.release();
            return;
        } catch (err) {
            console.error(`❌ Database connection failed (retries left: ${retries - 1})...`, err.message);
            retries--;
            if (retries === 0) {
                 console.error('❌ Could not connect to the database after several retries. Exiting.');
                 throw new Error('Could not connect to the database.');
            }
            await new Promise(res => setTimeout(res, 5000));
        }
    }
}

async function startServer() {
    await testDbConnection();
    console.log('Database is ready. Starting web server...');

    const app = express();
    const port = process.env.PORT || 3000;

    app.set('trust proxy', 1);

    // --- CORS Configuration ---
    const allowedOrigins = [
        'https://zingy-zabaione-a27ed6.netlify.app',
        'http://localhost:5173',
        'http://127.0.0.1:5500',
        'https://dpstore-backend-production.up.railway.app'
    ];
    const corsOptions = {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error(`Origin '${origin}' is not allowed by CORS`));
            }
        },
        credentials: true,
    };
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));

    // --- Middleware ---
    app.use(express.json());

    // --- Session Middleware ---
    app.use(session({
        store: new PgStore({
            pool: pool,
            tableName: 'user_sessions'
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 1 hari
        }
    }));

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

    const HOST = '0.0.0.0';
    app.listen(port, HOST, () => {
        console.log(`🚀 Server running on http://${HOST}:${port}`);
    });
}

// Jalankan fungsi startup
startServer().catch(error => {
    console.error("❌ Failed to start the server due to a critical error during initialization.", error);
    process.exit(1);
});