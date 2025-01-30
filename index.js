const express = require('express');
const { PrismaClient } = require('@prisma/client');
const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

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

// Product suggestions endpoint
app.get('/suggestions', async (req, res) => {
    try {
        const { query } = req.query; // Get parameter

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const pSuggestions = await prisma.pSuggestions.findMany({
            where: {
                name: {
                    contains: query, // Filter products
                    mode: 'insensitive' // case-insensitive
                }
            }
        });

        res.json(pSuggestions);
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
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});