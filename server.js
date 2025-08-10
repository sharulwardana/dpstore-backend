// File: Project/dpstore-backend/server.js [SUPER ISOLATION MODE]

const express = require('express');

console.log("--- Starting Server in SUPER ISOLATION MODE ---");
console.log("No other project files or database will be used.");

const app = express();
const port = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Satu-satunya rute
app.get('/health', (req, res) => {
    console.log("Health check hit. The server should remain stable.");
    res.status(200).send('Super Isolation Mode is Healthy!');
});

app.listen(port, HOST, () => {
    console.log(`🚀 Server is LIVE and running on http://${HOST}:${port}`);
    console.log("This is the final test. If this stops, it's a platform issue.");
});

// Menambahkan listener untuk melihat jika proses exit secara tidak terduga
process.on('exit', (code) => {
  console.log(`Process is exiting with code: ${code}`);
});