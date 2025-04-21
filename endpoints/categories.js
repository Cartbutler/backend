const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Categories endpoint
router.get('/', async (req, res) => {
    try {
        const { language_id = 'en-US' } = req.query;

        const categories = await prisma.categories.findMany({
            where: { language_id },
            select: {
                category_id: true,
                category_name: true,
                image_path: true,
            },
        });

        if (categories.length === 0) {
            console.warn('No categories found in the database.');
        }

        res.json(categories.map(category => ({
            category_id: category.category_id,
            category_name: category.category_name,
            image_path: category.image_path,
        })));
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

module.exports = router;