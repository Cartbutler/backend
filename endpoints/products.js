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
            name: {
                contains: term.toLowerCase()
            }
        }));

        const p_suggestions = await prisma.pSuggestions.findMany({
            where: {
                OR: conditions,
                language_id: language_id
            },
            orderBy: {
                priority: 'desc'
            },
            take: 5
        });

        res.json(p_suggestions.map(suggestion => ({
            id: suggestion.id,
            name: suggestion.name,
            priority: suggestion.priority,
            language_id: suggestion.language_id
        })));
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Search endpoint to search for products
router.get('/search', async (req, res) => {
    try {
        const { query, category_id, language_id = 'en-US' } = req.query; // Use snake_case for category_id

        if (!query && !category_id) {
            return res.status(400).json({ error: 'At least one of query or category_id parameter is required' });
        }

        const search_conditions = [];

        if (query) {
            const search_terms = query.split(/\s+/);
            search_terms.forEach(term => {
                search_conditions.push({
                    product_name: {
                        contains: term.toLowerCase()
                    }
                });
            });
        }

        if (category_id) {
            search_conditions.push({
                category_id: parseInt(category_id, 10) // Use category_id directly
            });
        }

        const products = await prisma.products.findMany({
            where: {
                OR: search_conditions,
                language_id: language_id
            },
            select: {
                product_id: true,
                product_name: true,
                image_path: true,
                product_store: {
                    select: {
                        price: true
                    }
                }
            },
            orderBy: {
                created_at: 'desc'
            }
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
                max_price
            };
        });

        res.json(productsWithPrices);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});
router.get('/product', async (req, res) => {
    try {
        const { id, language_id = 'en-US' } = req.query;

        if (!id) {
            return res.status(400).json({ error: 'id parameter is required' });
        }

        const product = await prisma.products.findUnique({
            where: {
                product_id: parseInt(id, 10),
                language_id: language_id
            },
            include: {
                product_store: {
                    include: {
                        stores: true
                    }
                }
            }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Calculate min and max prices from product_store table
        const prices = product.product_store.map(ps => ps.price);
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);

        // Prepare response data
        const responseData = {
            product_id: product.product_id,
            product_name: product.product_name,
            min_price,
            max_price,
            description: product.description,
            stock: product.stock,
            category_id: product.category_id,
            image_path: product.image_path,
            created_at: product.created_at,
            category_name: product.category_name,
            language_id: product.language_id,
            stores: product.product_store.map(ps => ({
                store_id: ps.store_id,
                price: ps.price,
                stock: ps.stock,
                store_name: ps.stores.store_name,
                store_location: ps.stores.store_location,
                store_address: ps.stores.store_address,
                latitude: ps.stores.latitude,
                longitude: ps.stores.longitude,
                store_image: ps.stores.store_image
            }))
        };

        res.json(responseData);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

module.exports = router;