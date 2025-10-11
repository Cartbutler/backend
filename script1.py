import os
import requests
from urllib.parse import urlparse
from pathlib import Path
from dotenv import load_dotenv
import pymysql
import sys
from datetime import datetime
import signal

# Load environment variables from .env file
load_dotenv()

# Timeout configuration
CONNECT_TIMEOUT = 10  # seconds to establish connection
READ_TIMEOUT = 30     # seconds to download
MAX_RETRIES = 2

class TimeoutError(Exception):
    pass

def timeout_handler(signum, frame):
    raise TimeoutError("Operation timed out")

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
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=10
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
    cursor = None
    try:
        cursor = connection.cursor()
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
    finally:
        if cursor:
            cursor.close()

def download_image(url, save_path, product_id):
    """
    Download an image from URL and save it locally with timeout protection
    """
    session = None
    try:
        # Handle both URLs and local file paths
        if not url.startswith(('http://', 'https://')):
            print(f"  ⚠ Not a valid HTTP/HTTPS URL: {url}")
            return False
        
        # Create a session with timeout
        session = requests.Session()
        session.mount('http://', requests.adapters.HTTPAdapter(max_retries=0))
        session.mount('https://', requests.adapters.HTTPAdapter(max_retries=0))
        
        # Set headers to mimic a browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        print(f"  → Attempting to download from: {url}")
        
        # Make request with explicit timeout
        response = session.get(
            url, 
            headers=headers,
            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
            stream=True,
            allow_redirects=True
        )
        
        # Check if request was successful
        if response.status_code == 404:
            print(f"  ✗ File not found (404): {url}")
            return False
        elif response.status_code != 200:
            print(f"  ✗ HTTP Error {response.status_code}: {url}")
            return False
        
        # Check content type
        content_type = response.headers.get('Content-Type', '')
        if not content_type.startswith('image/'):
            print(f"  ⚠ Warning: Content-Type is '{content_type}', not an image")
        
        # Download and save the file
        with open(save_path, 'wb') as f:
            downloaded_size = 0
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
        
        # Verify file was written
        if downloaded_size == 0:
            print(f"  ✗ Downloaded file is empty")
            if os.path.exists(save_path):
                os.remove(save_path)
            return False
        
        print(f"  ✓ Downloaded {downloaded_size} bytes")
        return True
            
    except requests.exceptions.Timeout:
        print(f"  ✗ Timeout: Request took longer than {CONNECT_TIMEOUT + READ_TIMEOUT} seconds")
        return False
    except requests.exceptions.ConnectionError:
        print(f"  ✗ Connection Error: Unable to connect to {url}")
        return False
    except requests.exceptions.RequestException as e:
        print(f"  ✗ Request failed: {e}")
        return False
    except Exception as e:
        print(f"  ✗ Unexpected error: {e}")
        return False
    finally:
        # Ensure session is closed
        if session:
            try:
                session.close()
            except:
                pass
        # Clean up response
        try:
            if 'response' in locals():
                response.close()
        except:
            pass

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
        failed_products = []
        
        for idx, product in enumerate(products, 1):
            product_id = product['product_id']
            product_name = product['product_name']
            image_path = product['image_path']
            
            print(f"\n[{idx}/{len(products)}] Product: {product_name} (ID: {product_id})")
            
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
            
            print(f"  📥 Saving to: {filename}")
            
            # Try to download with timeout protection
            try:
                success = download_image(image_path, save_path, product_id)
                
                if success:
                    successful_downloads += 1
                else:
                    failed_downloads += 1
                    failed_products.append({
                        'id': product_id,
                        'name': product_name,
                        'url': image_path
                    })
                    
            except Exception as e:
                print(f"  ✗ Critical error: {e}")
                failed_downloads += 1
                failed_products.append({
                    'id': product_id,
                    'name': product_name,
                    'url': image_path
                })
            
            # Force cleanup between downloads
            import gc
            gc.collect()
        
        # Print summary
        print("\n" + "=" * 50)
        print("Download Summary")
        print("=" * 50)
        print(f"✓ Successful downloads: {successful_downloads}")
        print(f"✗ Failed downloads: {failed_downloads}")
        print(f"📁 Images saved to: {download_dir.absolute()}")
        
        # Print failed products if any
        if failed_products:
            print("\n" + "=" * 50)
            print("Failed Downloads:")
            print("=" * 50)
            for fp in failed_products:
                print(f"  ID: {fp['id']} | {fp['name']}")
                print(f"  URL: {fp['url']}")
                print()
            
            # Save failed products to a file
            failed_log = download_dir / "failed_downloads.txt"
            with open(failed_log, 'w', encoding='utf-8') as f:
                f.write("Failed Downloads\n")
                f.write("=" * 50 + "\n\n")
                for fp in failed_products:
                    f.write(f"Product ID: {fp['id']}\n")
                    f.write(f"Product Name: {fp['name']}\n")
                    f.write(f"Image URL: {fp['url']}\n")
                    f.write("-" * 50 + "\n")
            print(f"📝 Failed downloads log saved to: {failed_log}")
        
    finally:
        # Close database connection
        try:
            connection.close()
            print("\n✓ Database connection closed")
        except:
            print("\n⚠ Warning: Issue closing database connection")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n✗ Download interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error in main: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
