# CartButler API

CartButler API is a Node.js application that provides various endpoints for managing categories, products, customers, and more. It uses Express.js for the server and Prisma for database interactions.

Api link
```sh
https://southern-shard-449119-d4.nn.r.appspot.com/
```

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Endpoints](#endpoints)
- [Environment Variables](#environment-variables)

## Installation

1. Clone the repository:

   ```sh
   git clone https://github.com/yourusername/CartButler.git
   cd CartButler
   ```

2. Install the dependencies:
   ```sh
   npm install
   ```

3. Set up the environment variables:
   - Create a `.env` file in the root directory and add the following:
     ```sh
     DATABASE_URL=mysql://cartbutler8946:conestoga8946@104.197.180.231:3306/cartbutler8946
     GCLOUD_STORAGE_BUCKET=your-bucket-name
     ```

4. Run the Prisma migrations:
   ```sh
   npx prisma migrate dev
   ```

## Usage

1. Start the server:
   ```sh
   node index.js
   ```

2. The server will be running at [http://localhost:5000](http://localhost:5000).

## Endpoints

### Root Route
- **GET /**

  Returns a welcome message.

  ```sh
  curl http://localhost:5000/
  ```

### List All Categories
- **GET /categories**

  Returns a list of all categories.

  ```sh
  curl http://localhost:5000/categories
  ```

### Product Suggestions
- **GET /suggestions**

  Returns product suggestions based on a query parameter.

  ```sh
  curl http://localhost:5000/suggestions?query=example
  ```

### Search Products
- **GET /search**

  Searches for products based on a query or categoryID parameter. At least one of the parameters is required. The endpoint returns products based on the provided parameters, limited to 10 results, and sorted by creation date.

  ```sh
  curl http://localhost:5000/search?query=example&categoryID=1
  ```

### Single Product Details
- **GET /product**

  Returns product details by ID.

  ```sh
  curl http://localhost:5000/product?id=1
  ```

### Add to Shopping Cart
- **POST /cart**

  Adds an item to the shopping cart or updates the quantity if the item already exists. If the quantity is set to 0, the item is removed from the cart.

  ```sh
  curl -X POST http://localhost:5000/cart -H "Content-Type: application/json" -d '{"userId": "1", "productId": "1", "quantity": 2}'
  ```

### Get Shopping Cart Item
- **GET /cart**

  Retrieves a single cart item for a user.

  ```sh
  curl http://localhost:5000/cart?userId=<USER ID>
  ```

### Shopping Results
- **POST /shopping-results**

  Calculates and returns the smallest shopping list price sorted by store price. The endpoint accepts a list of products with their quantities in the request body.

  ```sh
  curl -X POST http://localhost:5000/shopping-results -H "Content-Type: application/json" -d '{
    "products": [
      { "productId": 1, "quantity": 2 },
      { "productId": 2, "quantity": 1 },
      { "productId": 3, "quantity": 3 }
    ]
  }'
  ```

## Environment Variables

The following environment variables need to be set in the `.env` file:

- `DATABASE_URL`: The connection string for the database.
- `GCLOUD_STORAGE_BUCKET`: The name of your Google Cloud Storage bucket.