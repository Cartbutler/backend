const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fetchOrCreateCart(user_id) {
    let cart = await prisma.cart.findFirst({
        where: { user_id },
        include: {
            cart_items: {
                include: {
                    products: {
                        include: {
                            product_store: {
                                include: { stores: true },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!cart) {
        cart = await prisma.cart.create({
            data: {
                user_id,
                cart_items: { create: [] },
            },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: { stores: true },
                                },
                            },
                        },
                    },
                },
            },
        });
    }

    const prices = cart.cart_items.flatMap(cartItem =>
        cartItem.products.product_store.map(ps => ps.price)
    );
    const min_price = Math.min(...prices);
    const max_price = Math.max(...prices);

    return {
        ...cart,
        min_price,
        max_price,
    };
}

module.exports = fetchOrCreateCart;