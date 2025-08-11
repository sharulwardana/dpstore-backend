// File: Project/dpstore-backend/server.js [FIXED WITH DEBUG]

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

console.log('🚀 Starting DPStore Backend Server...');
console.log('Environment check:');
console.log('- DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('- JWT_SECRET exists:', !!process.env.JWT_SECRET);
console.log('- SESSION_SECRET exists:', !!process.env.SESSION_SECRET);
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT || 3000);

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

console.log('📊 Creating database pool...');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 5000
});

// Import route files
console.log('📁 Loading route modules...');
const publicRoutes = require('./routes/publicRoutes')(pool);
const authRoutes = require('./routes/authRoutes')(pool);
const adminRoutes = require('./routes/adminRoutes')(pool);
console.log('✅ Route modules loaded successfully');

async function testDbConnection(retries = 5) {
    while (retries > 0) {
        let client;
        try {
            console.log(`🔄 Attempting to connect to database (attempt ${6 - retries})...`);
            
            client = await pool.connect();
            console.log('✅ Database connection successful.');
            
            // Test a simple query
            const result = await client.query('SELECT NOW() as current_time');
            console.log('✅ Database query test successful:', result.rows[0]);
            
            if (client) client.release();
            return;
        } catch (err) {
            console.error(`❌ Database connection failed (retries left: ${retries - 1}):`, {
                message: err.message,
                code: err.code
            });
            
            retries--;
            if (retries === 0) {
                console.error('❌ Could not connect to the database after several retries. Exiting.');
                throw new Error(`Database connection failed: ${err.message}`);
            }
            console.log(`⏳ Waiting 5 seconds before retry...`);
            await new Promise(res => setTimeout(res, 5000));
        }
    }
}

async function startServer() {
    try {
        console.log('🔌 Testing database connection...');
        await testDbConnection();
        console.log('✅ Database is ready. Starting web server...');

        const app = express();
        const port = process.env.PORT || 3000;

        app.set('trust proxy', 1);

        // --- CORS Configuration ---
        console.log('🌐 Configuring CORS...');
        const allowedOrigins = [
            'https://zingy-zabaione-a27ed6.netlify.app',
            'http://localhost:5173',
            'http://127.0.0.1:5500',
            'https://dpstore-backend-production.up.railway.app',
            'https://healthcheck.railway.app'
        ];
        
        const corsOptions = {
            origin: (origin, callback) => {
                console.log('CORS request from origin:', origin || 'undefined');
                if (!origin || allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    console.warn(`CORS blocked origin: ${origin}`);
                    callback(new Error(`Origin '${origin}' is not allowed by CORS`));
                }
            },
            credentials: true,
        };
        app.use(cors(corsOptions));
        app.options('*', cors(corsOptions));
        console.log('✅ CORS configured');

        // --- Middleware ---
        console.log('⚙️  Setting up middleware...');
        app.use(express.json());

        // --- Middleware untuk Logging Request ---
        app.use((req, res, next) => {
            console.log(`[INCOMING REQUEST] ${new Date().toISOString()} | ${req.method} ${req.originalUrl} | From: ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
            next();
        });

        // --- Session Middleware ---
        console.log('🔐 Setting up session middleware...');
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
        console.log('✅ Session middleware configured');

        // --- SIMPLE Health Check (NO DATABASE TEST) ---
        app.get('/health', (req, res) => {
            console.log('🏥 Health check called from:', req.get('User-Agent') || 'unknown');
            console.log('🏥 Health check headers:', JSON.stringify(req.headers, null, 2));
            
            try {
                const response = { 
                    status: 'OK',
                    message: 'Server is healthy',
                    timestamp: new Date().toISOString(),
                    uptime: Math.floor(process.uptime()) + 's'
                };
                
                console.log('🏥 Sending health check response:', JSON.stringify(response, null, 2));
                res.status(200).json(response);
                console.log('🏥 Health check response sent successfully');
                
            } catch (error) {
                console.error('🏥 Health check error:', error);
                res.status(500).json({
                    status: 'ERROR',
                    error: error.message
                });
            }
        });

        // --- Root endpoint for testing ---
        app.get('/', (req, res) => {
            console.log('🏠 Root endpoint called');
            res.status(200).json({
                message: 'DPStore Backend API is running',
                version: '1.0.0',
                endpoints: {
                    health: '/health',
                    api: '/api',
                    auth: '/api/auth',
                    admin: '/api/admin'
                }
            });
        });

        // --- API Routes ---
        console.log('🛣️  Setting up API routes...');
        app.use('/api', publicRoutes);
        app.use('/api/auth', authRoutes);
        app.use('/api/admin', adminRoutes);
        console.log('✅ API routes configured');

        // --- Global Error Handler ---
        app.use((err, req, res, next) => {
            console.error('🚨 Global Error Handler:', err.stack);
            res.status(500).json({ error: 'Something went wrong on the server!' });
        });

        // --- 404 Handler ---
        app.use('*', (req, res) => {
            console.log('🔍 404 - Route not found:', req.originalUrl);
            res.status(404).json({ error: 'Route not found' });
        });

        const HOST = '0.0.0.0';
        const server = app.listen(port, HOST, () => {
            console.log(`🚀 Server running successfully on http://${HOST}:${port}`);
            console.log(`🌍 Health check available at: http://${HOST}:${port}/health`);
            console.log(`📊 API endpoints available at: http://${HOST}:${port}/api`);
            console.log('✅ DPStore Backend is ready to serve requests!');
        });

        // Keep server alive
        server.keepAliveTimeout = 65000;
        server.headersTimeout = 66000;

        // Enhanced graceful shutdown handling
        let isShuttingDown = false;
        
        const gracefulShutdown = (signal) => {
            if (isShuttingDown) {
                console.log(`Already shutting down, ignoring ${signal}`);
                return;
            }
            
            isShuttingDown = true;
            console.log(`🛑 Received ${signal}. Graceful shutdown initiated...`);
            
            // Stop accepting new connections
            server.close(() => {
                console.log('✅ HTTP server closed.');
                
                // Close database pool
                pool.end(() => {
                    console.log('✅ Database pool closed.');
                    console.log('✅ Graceful shutdown completed');
                    process.exit(0);
                });
            });
            
            // Force shutdown after 30 seconds
            setTimeout(() => {
                console.error('⏰ Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 30000);
        };

        // Listen for shutdown signals
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        
        // Keep process alive
        setInterval(() => {
            console.log(`💓 Server heartbeat - uptime: ${Math.floor(process.uptime())}s`);
        }, 30000); // Every 30 seconds
        
    } catch (error) {
        console.error("❌ Failed to start the server due to a critical error during initialization:", error);
        process.exit(1);
    }
}

// Jalankan fungsi startup
console.log('🎬 Initiating server startup sequence...');
startServer().catch(error => {
    console.error("❌ Server startup failed with critical error:", error);
    process.exit(1);
});