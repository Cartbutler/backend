const express = require('express');
const router = express.Router();
const calculateDistances = require('../utils/calculate_distances');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Shopping results endpoint
router.get('/', async (req, res) => {
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

module.exports = router;