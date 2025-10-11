import os
import requests
from urllib.parse import urlparse
from pathlib import Path
from dotenv import load_dotenv
import pymysql
import sys
from datetime import datetime

# Load environment variables from .env file
load_dotenv()

def parse_database_url(database_url):
    """
    Parse the DATABASE_URL to extract connection parameters
    Format: mysql://user:pass@host:3306/dbname
    """
    try:
        parsed = urlparse(database_url)
        
        # Extract connection parameters
        connection_params = {
            'host': parsed.hostname,
            'port': parsed.port or 3306,
            'user': parsed.username,
            'password': parsed.password,
            'database': parsed.path.lstrip('/')
        }
        
        return connection_params
    except Exception as e:
        print(f"Error parsing DATABASE_URL: {e}")
        sys.exit(1)

def connect_to_database(connection_params):
    """
    Establish connection to MySQL database
    """
    try:
        connection = pymysql.connect(
            host=connection_params['host'],
            port=connection_params['port'],
            user=connection_params['user'],
            password=connection_params['password'],
            database=connection_params['database'],
            cursorclass=pymysql.cursors.DictCursor
        )
        print(f"✓ Connected to database: {connection_params['database']}")
        return connection
    except pymysql.Error as e:
        print(f"✗ Failed to connect to database: {e}")
        sys.exit(1)

def fetch_image_paths(connection):
    """
    Fetch all image paths from the products table
    """
    try:
        with connection.cursor() as cursor:
            query = """
                SELECT product_id, product_name, image_path 
                FROM products 
                WHERE image_path IS NOT NULL AND image_path != ''
            """
            cursor.execute(query)
            results = cursor.fetchall()
            print(f"✓ Found {len(results)} products with images")
            return results
    except pymysql.Error as e:
        print(f"✗ Error fetching data: {e}")
        return []

def download_image(url, save_path):
    """
    Download an image from URL and save it locally
    """
    try:
        # Only process HTTP/HTTPS URLs
        if not url.startswith(('http://', 'https://')):
            print(f"  ✗ Not a valid URL: {url}")
            return False
        
        # Download with streaming to handle large files
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        # Write to file
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        
        return True
        
    except Exception as e:
        print(f"  ✗ Error: {e}")
        # Remove partial file if it exists
        if os.path.exists(save_path):
            os.remove(save_path)
        return False

def create_download_directory():
    """
    Create a directory to store downloaded images
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    download_dir = Path(f"downloaded_images_{timestamp}")
    download_dir.mkdir(exist_ok=True)
    return download_dir

def sanitize_filename(filename):
    """
    Remove invalid characters from filename
    """
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, '_')
    # Limit filename length
    if len(filename) > 100:
        filename = filename[:100]
    return filename

def main():
    """
    Main function to orchestrate the image download process
    """
    print("=" * 50)
    print("Product Image Downloader")
    print("=" * 50)
    
    # Get DATABASE_URL from environment
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("✗ DATABASE_URL not found in .env file")
        sys.exit(1)
    
    # Parse database connection parameters
    connection_params = parse_database_url(database_url)
    
    # Connect to database
    connection = connect_to_database(connection_params)
    
    try:
        # Fetch image paths
        products = fetch_image_paths(connection)
        
        if not products:
            print("No images to download")
            return
        
        # Create download directory
        download_dir = create_download_directory()
        print(f"✓ Created download directory: {download_dir}")
        
        # Download images
        print(f"\nDownloading {len(products)} images...")
        print("-" * 50)
        
        successful_downloads = 0
        failed_downloads = 0
        
        for idx, product in enumerate(products, 1):
            product_id = product['product_id']
            product_name = product['product_name']
            image_path = product['image_path']
            
            print(f"\n[{idx}/{len(products)}] Product ID {product_id}: {product_name}")
            print(f"  URL: {image_path}")
            
            # Extract filename from image_path
            if '/' in image_path:
                original_filename = image_path.split('/')[-1]
            else:
                original_filename = image_path
            
            # Create a unique filename
            sanitized_name = sanitize_filename(product_name)
            file_extension = Path(original_filename).suffix or '.jpg'
            filename = f"{product_id}_{sanitized_name}{file_extension}"
            save_path = download_dir / filename
            
            # Download the image
            if download_image(image_path, save_path):
                print(f"  ✓ Saved: {filename}")
                successful_downloads += 1
            else:
                failed_downloads += 1
        
        # Print summary
        print("\n" + "=" * 50)
        print("Download Summary")
        print("=" * 50)
        print(f"✓ Successful downloads: {successful_downloads}")
        print(f"✗ Failed downloads: {failed_downloads}")
        print(f"📁 Images saved to: {download_dir.absolute()}")
        
    except Exception as e:
        print(f"\n✗ Error during download process: {e}")
    finally:
        # Close database connection
        connection.close()
        print("\n✓ Database connection closed")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n✗ Download interrupted by user")
        sys.exit(1)