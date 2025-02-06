# CartButler API

CartButler API is a Node.js application that provides various endpoints for managing categories, products, customers, and more. It uses Express.js for the server, Prisma for database interactions, and Multer for file uploads.

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
2. Install the dependecies:
```sh
npm install
```

4. Set up the environment variables: 
Create a .env file in the root directory and add the following:
```sh
DATABASE_URL=mysql://cartbutler8946:conestoga8946@104.197.180.231:3306/cartbutler8946
```
6. Run the Prisma migrations:
```sh
npx prisma migrate dev
```

# Usage
1. Start the server:
```sh
node index.js
```
3. The server will be running at http://localhost:5000.

# Endpoints
Root Route
GET /
Returns a welcome message.
```sh
curl http://localhost:5000/
```

Upload an Image
POST /upload

Uploads an image file.
```sh
curl -X POST -F "image=@/path/to/your/image.jpg" http://localhost:5000/upload
```

List All Categories
GET /categories
Returns a list of all categories.

```sh
curl http://localhost:5000/categories
```

Product Suggestions
GET /suggestions
Returns product suggestions based on a query parameter.
```sh
curl http://localhost:5000/suggestions?query=example
```

# Environment Variables
The following environment variables need to be set in the .env file:

DATABASE_URL: The connection string for the database.
