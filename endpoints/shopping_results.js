const express = require('express');
const router = express.Router();
const calculateDistance = require('../utils/calculate_distances');
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

        // Get the stores for the cart
        const stores = await prisma.cart_store_complete.findMany({
            where: {
                cart_id: parsed_cart_id,
                user_id: user_id,
                ...(storeIdsArray.length > 0 && { store_id: { in: storeIdsArray } })
            }
        });

        if (!stores || stores.length === 0) {
            return res.status(404).json({ error: 'No stores found for this cart' });
        }

        // Transform the data
        let result = stores.map(store => ({
            store_id: store.store_id,
            store_name: store.store_name,
            store_location: store.store_location,
            store_address: store.store_address,
            latitude: store.latitude,
            longitude: store.longitude,
            distance: (user_lat && user_lon) ? calculateDistance(user_lat, user_lon, store.latitude, store.longitude) : null,
            store_image: store.store_image,
            products: store.products,
            total: store.total,
            is_complete: store.is_complete
        }));

        // Filter by radius if provided
        if (radius && user_lat && user_lon) {
            const radiusValue = parseFloat(radius);

            // Filter stores within radius
            result = result.filter(store => store.distance <= radiusValue);
        }

        res.json(result);
    } catch (err) {
        console.error('Error fetching shopping results:', err.message);
        res.status(500).json({ error: 'Error fetching shopping results', details: err.message });
    }
});

module.exports = router;