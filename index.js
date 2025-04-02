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
const host = process.env.HOST || 'localhost';

app.use(express.json());
app.use(cors()); // Enable CORS for all routes

const prisma = new PrismaClient();

// Set up Google Cloud Storage
const storage = new Storage();
const bucket_name = process.env.GCLOUD_STORAGE_BUCKET; // Replace with your actual bucket name
const bucket = storage.bucket(bucket_name);

// Function to resize an image asynchronously
async function resize_image_async(image_url, image_name) {
    try {
        const fetch = (await import('node-fetch')).default; // Dynamically import node-fetch
        const response = await fetch(image_url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image from URL: ${image_url}`);
        }
        const buffer = await response.buffer();

        const resized_buffer = await sharp(buffer)
            .resize(160, 160)
            .toBuffer();

        const resized_image_name = `160x160-${image_name}`;
        const resized_image_blob = bucket.file(resized_image_name);

        // Check if the resized image already exists
        const [exists] = await resized_image_blob.exists();
        if (!exists) {
            await resized_image_blob.save(resized_buffer);
        }
    } catch (err) {
        console.error('Image resizing error:', err.message);
    }
}

async function fetch_or_create_cart(user_id) {
    let cart = await prisma.cart.findFirst({
        where: { user_id: user_id },
        include: {
            cart_items: {
                include: {
                    products: {
                        include: {
                            product_store: {
                                include: {
                                    stores: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!cart) {
        cart = await prisma.cart.create({
            data: {
                user_id: user_id,
                cart_items: {
                    create: []
                }
            },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: {
                                        stores: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    return cart;
}

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the CartButler API this screen is just a landing page');
});

// Categories endpoint.
app.get('/categories', async (req, res) => {
    try {
        const { language_id = 'en-US' } = req.query; // Get language_id parameter or default to 'en-US'

        const categories = await prisma.categories.findMany({
            where: {
                language_id: language_id
            },
            select: {
                category_id: true,
                category_name: true,
                image_path: true
            }
        });

        console.log('Categories fetched:', categories); // Log the fetched categories

        if (categories.length === 0) {
            console.warn('No categories found in the database.');
        }

        res.json(categories.map(category => ({
            category_id: category.category_id,
            category_name: category.category_name,
            image_path: category.image_path
        })));
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Product suggestions endpoint with multi-word search support and language_id filter
app.get('/suggestions', async (req, res) => {
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

// Single product endpoint to get product details by ID or query
app.get('/product', async (req, res) => {
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

// Search endpoint to search for products
app.get('/search', async (req, res) => {
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
                    product_name: {
                        contains: term.toLowerCase()
                    }
                });
            });
        }

        if (category_id) {
            search_conditions.push({
                category_id: parseInt(category_id, 10)
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

        // Fire-and-forget task to resize images asynchronously
        products.forEach(product => {
            const image_name = path.basename(product.image_path);
            resize_image_async(product.image_path, image_name);
        });

        // Calculate min and max prices for each product from product_store table
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

// Cart endpoint (POST)
app.post('/cart', async (req, res) => {
    try {
        const { user_id, product_id, quantity } = req.body;

        if (!user_id || !product_id || quantity === undefined) {
            return res.status(400).json({ error: 'user_id, product_id, and quantity are required' });
        }

        // Check if the user exists, create if not
        let user = await prisma.users.findUnique({
            where: { user_id: user_id }
        });

        if (!user) {
            user = await prisma.users.create({
                data: { user_id: user_id }
            });
        }

        // Check if the product exists
        const product = await prisma.products.findUnique({
            where: { product_id: product_id }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Fetch or create the cart for the user
        let cart = await prisma.cart.findFirst({
            where: { user_id: user_id },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: {
                                        stores: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!cart) {
            cart = await prisma.cart.create({
                data: {
                    user_id: user_id,
                    cart_items: {
                        create: []
                    }
                },
                include: {
                    cart_items: {
                        include: {
                            products: {
                                include: {
                                    product_store: {
                                        include: {
                                            stores: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        if (quantity === 0) {
            // Remove the product from the cart
            await prisma.cart_items.deleteMany({
                where: {
                    cart_id: cart.id,
                    product_id: product_id
                }
            });
        } else {
            // Add or update the product in the user's cart
            await prisma.cart_items.upsert({
                where: {
                    cart_id_product_id: {
                        cart_id: cart.id,
                        product_id: product_id
                    }
                },
                update: {
                    quantity: quantity
                },
                create: {
                    cart_id: cart.id,
                    product_id: product_id,
                    quantity: quantity
                }
            });
        }

        // Retrieve the updated cart with cart items
        cart = await prisma.cart.findFirst({
            where: { user_id: user_id },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: {
                                        stores: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Calculate min and max prices from cart items
        const prices = cart.cart_items.flatMap(cartItem => cartItem.products.product_store.map(ps => ps.price));
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);

        // Prepare response data
        const responseData = {
            id: cart.id,
            user_id: cart.user_id,
            min_price,
            max_price,
            cart_items: cart.cart_items.map(cartItem => ({
                id: cartItem.id,
                cart_id: cartItem.cart_id,
                product_id: cartItem.product_id,
                quantity: cartItem.quantity,
                products: {
                    product_id: cartItem.products.product_id,
                    product_name: cartItem.products.product_name,
                    description: cartItem.products.description,
                    price: cartItem.products.price,
                    stock: cartItem.products.stock,
                    category_id: cartItem.products.category_id,
                    image_path: cartItem.products.image_path,
                    created_at: cartItem.products.created_at,
                    category_name: cartItem.products.category_name,
                    language_id: cartItem.products.language_id,
                    product_store: cartItem.products.product_store.map(ps => ({
                        store_id: ps.store_id,
                        price: ps.price,
                        stock: ps.stock,
                        store_name: ps.stores?.store_name,
                        store_location: ps.stores?.store_location,
                        store_image: ps.stores?.store_image
                    }))
                }
            }))
        };

        console.log(`User ${user_id} updated their cart with product ${product_id} and quantity ${quantity}`);
        res.json(responseData);
    } catch (err) {
        console.error('Error updating cart:', err.message);
        res.status(500).json({ error: 'Error updating cart', details: err.message });
    }
});

// Get shopping cart endpoint (GET)
app.get('/cart', async (req, res) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ error: 'user_id is required' });
        }

        // Fetch or create the user's cart with cart items
        const cart = await fetch_or_create_cart(user_id);

        // Calculate min and max prices from cart items
        const prices = cart.cart_items.flatMap(cartItem => cartItem.products.product_store.map(ps => ps.price));
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);

        // Prepare response data
        const responseData = {
            id: cart.id,
            user_id: cart.user_id,
            cart_items: cart.cart_items.map(cartItem => ({
                id: cartItem.id,
                cart_id: cartItem.cart_id,
                product_id: cartItem.product_id,
                quantity: cartItem.quantity,
                products: {
                    product_id: cartItem.products.product_id,
                    product_name: cartItem.products.product_name,
                    description: cartItem.products.description,
                    min_price: Math.min(...cartItem.products.product_store.map(ps => ps.price)),
                    max_price: Math.max(...cartItem.products.product_store.map(ps => ps.price)),
                    stock: cartItem.products.stock,
                    category_id: cartItem.products.category_id,
                    image_path: cartItem.products.image_path,
                    created_at: cartItem.products.created_at,
                    category_name: cartItem.products.category_name,
                    language_id: cartItem.products.language_id,
                    product_store: cartItem.products.product_store.map(ps => ({
                        store_id: ps.store_id,
                        price: ps.price,
                        stock: ps.stock,
                        store_name: ps.stores?.store_name,
                        store_location: ps.stores?.store_location,
                        store_address: ps.stores?.store_address,
                        latitude: ps.stores?.latitude,
                        longitude: ps.stores?.longitude,
                        store_image: ps.stores?.store_image
                    }))
                }
            }))
        };

        console.log(`User ${user_id} retrieved their cart items`);
        res.json(responseData);
    } catch (err) {
        console.error('Error retrieving cart items:', err.message);
        res.status(500).json({ error: 'Error retrieving cart items', details: err.message });
    }
});

// Shopping results endpoint (GET)
// This endpoint fetches the shopping results based on the user's cart and filters by store IDs and radius
app.get('/shopping-results', async (req, res) => {
    try {
        const { cart_id, user_id, radius, store_ids, user_location } = req.query;

        if (!cart_id || !user_id) {
            return res.status(400).json({ error: 'cart_id and user_id parameters are required' });
        }

        if (radius && !user_location) {
            return res.status(400).json({ error: 'user_location parameter is required when radius is provided' });
        }

        const parsed_cart_id = parseInt(cart_id, 10);
        if (isNaN(parsed_cart_id)) {
            return res.status(400).json({ error: 'Invalid cart_id parameter' });
        }

        // Parse user_location into latitude and longitude
        let user_lat, user_lon;
        if (user_location) {
            [user_lat, user_lon] = user_location.split(',').map(Number);
            if (isNaN(user_lat) || isNaN(user_lon)) {
                return res.status(400).json({ error: 'Invalid user_location parameter' });
            }
        }

        // Parse store_ids into an array of integers
        const storeIdsArray = store_ids ? store_ids.split(',').map(id => parseInt(id, 10)) : [];

        // Build the where clause for the Prisma query
        const whereClause = {
            id: parsed_cart_id,
            user_id: user_id,
            cart_items: {
                some: {
                    products: {
                        product_store: {
                            some: {
                                stores: storeIdsArray.length > 0 ? { store_id: { in: storeIdsArray } } : {}
                            }
                        }
                    }
                }
            }
        };

        // Fetch the cart with cart items for the user
        const cart = await prisma.cart.findFirst({
            where: whereClause,
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: {
                                        stores: true // Include store details
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!cart) {
            return res.status(404).json({ error: 'Cart not found or does not belong to the user' });
        }

        // Group products by store
        const store_products = cart.cart_items.reduce((acc, cartItem) => {
            cartItem.products.product_store.forEach(productStore => {
                const store_id = productStore.store_id;
                if (!acc[store_id]) {
                    acc[store_id] = {
                        store_id: productStore.stores.store_id,
                        store_name: productStore.stores.store_name,
                        store_location: productStore.stores.store_location,
                        store_address: productStore.stores.store_address,
                        latitude: productStore.stores.latitude, // Latitude from stores table
                        longitude: productStore.stores.longitude, // Longitude from stores table
                        distance: null, // Initialize distance as null
                        store_image: productStore.stores.store_image,
                        products: [],
                        total: 0
                    };
                }
                acc[store_id].products.push({
                    product_id: cartItem.product_id,
                    product_name: cartItem.products.product_name,
                    price: productStore.price,
                    quantity: cartItem.quantity
                });
                acc[store_id].total += productStore.price * cartItem.quantity;
            });
            return acc;
        }, {});

        console.log('Store products:', store_products);

        // Filter by radius if provided
        const stores_filtered_by_radius = radius
            ? await calculateDistances(user_lat, user_lon, Object.values(store_products))
                  .then(distances => {
                      // Map distances back to the stores
                      distances.forEach(({ store_id, distance }) => {
                          const store = store_products[store_id];
                          if (store) {
                              store.distance = `${distance.toFixed(3)} km`; // Add distance to the store object
                          }
                      });

                      // Filter stores by radius
                      return Object.values(store_products).filter(store => parseFloat(store.distance) <= parseFloat(radius));
                  })
            : Object.values(store_products);

        console.log('Filtered stores by radius:', stores_filtered_by_radius);

        // Filter out stores with zero products
        const non_empty_stores = stores_filtered_by_radius.filter(store => store.products.length > 0);

        console.log('Non-empty stores:', non_empty_stores);

        // Sort the filtered stores by total price
        const sorted_stores = non_empty_stores.sort((a, b) => a.total - b.total);

        console.log('Sorted stores:', sorted_stores);

        res.json(sorted_stores);
    } catch (err) {
        console.error('Error fetching shopping results:', err.message);
        res.status(500).json({ error: 'Error fetching shopping results', details: err.message });
    }
});

async function calculateDistances(user_lat, user_lon, stores) {
    try {
        // Build a UNION ALL query for the batch input
        const unionQuery = stores
            .map(
                store =>
                    `SELECT ${user_lat} AS lat1, ${user_lon} AS lon1, ${store.latitude} AS lat2, ${store.longitude} AS lon2, ${store.store_id} AS store_id`
            )
            .join(' UNION ALL ');

        // Execute a single query to calculate distances for all stores
        const result = await prisma.$queryRawUnsafe(`
            SELECT
                store_id,
                6371 * 2 * ASIN(SQRT(
                    POWER(SIN(RADIANS(lat2 - lat1) / 2), 2) +
                    COS(RADIANS(lat1)) * COS(RADIANS(lat2)) *
                    POWER(SIN(RADIANS(lon2 - lon1) / 2), 2)
                )) AS distance
            FROM (${unionQuery}) AS input;
        `);

        console.log('Batch distance calculation result:', result);
        return result;
    } catch (err) {
        console.error('Error calculating distances:', err.message);
        throw new Error('Failed to calculate distances');
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});
