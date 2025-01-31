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

// Product suggestions endpoint with multi-word search support
app.get('/suggestions', async (req, res) => {
    try {
        const { query } = req.query; // Get query parameter

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const searchTerms = query.split(/\s+/); // Format to split with whitespace

        const conditions = searchTerms.map(term => ({
            name: {
                contains: term,
                mode: 'insensitive' // case-insensitive
            }
        }));

        const pSuggestions = await prisma.pSuggestions.findMany({
            where: {
                AND: conditions // Ensure all words are matched
            },
            orderBy: {
                priority: 'desc' // Sorting by priority
            },
            take: 5 // Limit results
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
