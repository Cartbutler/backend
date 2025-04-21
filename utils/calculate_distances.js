const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

module.exports = calculateDistances;