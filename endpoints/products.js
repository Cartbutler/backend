const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const resizeImage = require('../utils/resize_image');

// Product suggestions endpoint
router.get('/suggestions', async (req, res) => {
    try {
        const { query, language_id = 'en-US' } = req.query;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const search_terms = query.split(/\s+/);
        const conditions = search_terms.map(term => ({
            name: { contains: term.toLowerCase() },
        }));

        const suggestions = await prisma.pSuggestions.findMany({
            where: { OR: conditions, language_id },
            orderBy: { priority: 'desc' },
            take: 5,
        });

        res.json(suggestions.map(suggestion => ({
            id: suggestion.id,
            name: suggestion.name,
            priority: suggestion.priority,
            language_id: suggestion.language_id,
        })));
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Search endpoint
router.get('/search', async (req, res) => {
    try {
        const { query, category_id, language_id = 'en-US' } = req.query;

        if (!query && !category_id) {
            return res.status(400).json({ error: 'At least one of query or category_id parameter is required' });
        }

        const search_conditions = [];
        if (query) {
            const search_terms = query.split(/\s+/);
            search_terms.forEach(term => {
                search_conditions.push({
                    product_name: { contains: term.toLowerCase() },
                });
            });
        }

        if (category_id) {
            search_conditions.push({ category_id: parseInt(category_id, 10) });
        }

        const products = await prisma.products.findMany({
            where: { OR: search_conditions, language_id },
            select: {
                product_id: true,
                product_name: true,
                image_path: true,
                product_store: { select: { price: true } },
            },
            orderBy: { created_at: 'desc' },
        });

        products.forEach(product => {
            const image_name = path.basename(product.image_path);
            resizeImage(product.image_path, image_name);
        });

        const productsWithPrices = products.map(product => {
            const prices = product.product_store.map(ps => ps.price);
            const min_price = Math.min(...prices);
            const max_price = Math.max(...prices);

            return {
                product_id: product.product_id,
                product_name: product.product_name,
                image_path: product.image_path,
                min_price,
                max_price,
            };
        });

        res.json(productsWithPrices);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

module.exports = router;