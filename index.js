const express = require('express');
const { PrismaClient } = require('@prisma/client');
const helmet = require('helmet');
const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(helmet());

const prisma = new PrismaClient();

// GET - List all categories
app.get('/categories', async (req, res) => {
    try {
        const categories = await prisma.category.findMany();
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: 'Database query error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the server
const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(async () => {
        console.log('HTTP server closed');
        await prisma.$disconnect();
        process.exit(0);
    });
});