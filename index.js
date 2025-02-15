require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Import the cors package
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const sharp = require('sharp'); // Add sharp for image processing
const fetch = require('node-fetch'); // Add node-fetch for fetching images
const app = express();
const port = process.env.PORT || 5000;
const host = process.env.HOST || 'localhost'; // Bind to localhost

app.use(express.json());
app.use(cors()); // Enable CORS for all routes

const prisma = new PrismaClient();

// Set up Google Cloud Storage
const storage = new Storage();
const bucketName = process.env.GCLOUD_STORAGE_BUCKET; // Replace with your actual bucket name
const bucket = storage.bucket(bucketName);

// Function to resize an image asynchronously
async function resizeImageAsync(imageUrl, imageName) {
    try {
        const response = await fetch(imageUrl);
        const buffer = await response.buffer();

        const resizedBuffer = await sharp(buffer)
            .resize(160, 160)
            .toBuffer();

        const resizedImageName = `160x160-${imageName}`;
        const resizedImageBlob = bucket.file(resizedImageName);

        // Check if the resized image already exists
        const [exists] = await resizedImageBlob.exists();
        if (!exists) {
            await resizedImageBlob.save(resizedBuffer);
        }
    } catch (err) {
        console.error('Image resizing error:', err.message);
    }
}

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the CartButler API this screen is just a landing page');
});

// Example endpoint to list all categories
app.get('/categories', async (req, res) => {
    try {
        const categories = await prisma.categories.findMany();
        res.json(categories);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
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
                contains: term.toLowerCase()
            }
        }));

        const pSuggestions = await prisma.pSuggestions.findMany({
            where: {
                OR: conditions
            },
            orderBy: {
                priority: 'desc' // Sorting by priority
            },
            take: 5 // Limit results
        });

        res.json(pSuggestions);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Products endpoint to display all products
app.get('/products', async (req, res) => {
    try {
        const products = await prisma.products.findMany({
            select: {
                product_name: true,
                image_path: true,
                description: true,
                price: true,
            },
            orderBy: {
                created_at: 'desc' // Sorting by creation date
            }
        });

        res.json(products);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Search endpoint to search for products
app.get('/search', async (req, res) => {
    try {
        const { query, categoryID } = req.query; // Get query and categoryID parameters

        if (!query && !categoryID) {
            return res.status(400).json({ error: 'At least one of query or categoryID parameter is required' });
        }

        const searchConditions = [];

        if (query) {
            const searchTerms = query.split(/\s+/); // Split query into search terms
            searchTerms.forEach(term => {
                searchConditions.push({
                    product_name: {
                        contains: term.toLowerCase()
                    }
                });
            });
        }

        if (categoryID) {
            searchConditions.push({
                category_id: parseInt(categoryID, 10)
            });
        }

        const products = await prisma.products.findMany({
            where: {
                OR: searchConditions
            },
            select: {
                product_id: true,
                product_name: true,
                image_path: true,
                price: true,
            },
            orderBy: {
                created_at: 'desc' // Sorting by creation date
            }
        });

        // Fire-and-forget task to resize images asynchronously
        products.forEach(product => {
            const imageName = path.basename(product.image_path);
            resizeImageAsync(product.image_path, imageName);
        });

        res.json(products);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});