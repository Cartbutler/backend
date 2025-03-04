require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Import the cors package
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const sharp = require('sharp'); // Add sharp for image processing
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
        const fetch = (await import('node-fetch')).default; // Dynamically import node-fetch
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image from URL: ${imageUrl}`);
        }
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
        const categories = await prisma.categories.findMany({
            select: {
                category_id: true,
                category_name: true,
                image_path: true, // Include image_path in the response
            }
        });

        console.log('Categories fetched:', categories); // Log the fetched categories

        if (categories.length === 0) {
            console.warn('No categories found in the database.');
        }

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

// Single product endpoint to get product details by ID or query
app.get('/product', async (req, res) => {
    try {
        const { id } = req.query; // Get id parameter

        if (!id) {
            return res.status(400).json({ error: 'id parameter is required' });
        }

        const product = await prisma.products.findUnique({
            where: {
                product_id: parseInt(id, 10)
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

        // Calculate min and max prices
        const prices = product.product_store.map(ps => ps.price);
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);

        // Prepare response data
        const responseData = {
            product_id: product.product_id,
            product_name: product.product_name,
            description: product.description,
            price: product.price,
            stock: product.stock,
            category_id: product.category_id,
            image_path: product.image_path,
            created_at: product.created_at,
            category_name: product.category_name,
            stores: product.product_store.map(ps => ({
                store_id: ps.store_id,
                price: ps.price,
                stock: ps.stock,
                store_name: ps.stores.store_name,
                store_location: ps.stores.store_location
            })),
            min_price,
            max_price
        };

        res.json(responseData);
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

// Add to shopping cart endpoint (POST)
app.post('/cart', async (req, res) => {
    try {
        const { userId, productId, quantity } = req.body;

        if (!userId || !productId || quantity === undefined) {
            return res.status(400).json({ error: 'userId, productId, and quantity are required' });
        }

        // Check if the product exists
        const product = await prisma.products.findUnique({
            where: { product_id: productId }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        if (quantity === 0) {
            // Remove the product from the cart
            await prisma.cart.delete({
                where: {
                    userId_productId: {
                        userId: userId,
                        productId: productId
                    }
                }
            });
        } else {
            // Add or update the product in the user's cart
            await prisma.cart.upsert({
                where: {
                    userId_productId: {
                        userId: userId,
                        productId: productId
                    }
                },
                update: {
                    quantity: quantity // Set the quantity directly
                },
                create: {
                    userId: userId,
                    productId: productId,
                    quantity: quantity
                }
            });
        }

        // Retrieve the updated cart item
        const updatedCartItem = await prisma.cart.findUnique({
            where: {
                userId_productId: {
                    userId: userId,
                    productId: productId
                }
            },
            include: {
                product: true
            }
        });

        console.log(`User ${userId} updated their cart with product ${productId} and quantity ${quantity}`);
        res.json(updatedCartItem);
    } catch (err) {
        console.error('Error updating cart:', err.message);
        res.status(500).json({ error: 'Error updating cart', details: err.message });
    }
});

// Get shopping cart endpoint (GET)
app.get('/cart', async (req, res) => {
    try {
        const { userId, productId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!productId) {
            return res.status(400).json({ error: 'productId is required' });
        }

        // Retrieve the user's cart item
        const cartItem = await prisma.cart.findUnique({
            where: {
                userId_productId: {
                    userId: userId, // Correct field name
                    productId: parseInt(productId, 10)
                }
            },
            include: {
                products: true // Correct include statement
            }
        });

        if (!cartItem) {
            return res.status(404).json({ error: 'Cart item not found' });
        }

        console.log(`User ${userId} retrieved their cart item for product ${productId}`);
        res.json(cartItem);
    } catch (err) {
        console.error('Error retrieving cart item:', err.message);
        res.status(500).json({ error: 'Error retrieving cart item', details: err.message });
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