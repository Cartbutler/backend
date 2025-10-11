import os
import requests
from urllib.parse import urlparse, urljoin
from pathlib import Path
from dotenv import load_dotenv
import pymysql
import sys
from datetime import datetime
import signal
import time
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

# Load environment variables from .env file
load_dotenv()

# Global variable to track timeout
download_timeout = False

def timeout_handler(signum, frame):
    """Handle timeout signal"""
    global download_timeout
    download_timeout = True
    raise TimeoutError("Download timeout")

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

def create_session_with_retries():
    """
    Create a requests session with retry strategy
    """
    session = requests.Session()
    retry = Retry(
        total=3,
        read=3,
        connect=3,
        backoff_factor=0.3,
        status_forcelist=(500, 502, 504)
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    return session

def download_image(url, save_path, session, base_url=None, max_retries=3):
    """
    Download an image from URL and save it locally with timeout and retry logic
    """
    global download_timeout
    download_timeout = False
    
    # If URL is relative, make it absolute
    if base_url and not url.startswith(('http://', 'https://', '//')):
        url = urljoin(base_url, url)
    elif url.startswith('//'):
        url = 'https:' + url
    
    # Skip if not a valid URL
    if not url.startswith(('http://', 'https://')):
        print(f"  ⚠ Invalid URL format: {url}")
        return False
    
    attempt = 0
    while attempt < max_retries:
        attempt += 1
        try:
            # Set timeout for both connection and read
            response = session.get(
                url, 
                stream=True, 
                timeout=(10, 30),  # (connection timeout, read timeout)
                allow_redirects=True
            )
            response.raise_for_status()
            
            # Check if content is actually an image
            content_type = response.headers.get('content-type', '')
            if 'image' not in content_type.lower() and attempt == 1:
                print(f"  ⚠ Warning: Content-Type is {content_type}, might not be an image")
            
            # Download with progress tracking
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            chunk_size = 8192
            
            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        
                        # Show progress for large files
                        if total_size > 0:
                            percent = (downloaded / total_size) * 100
                            if total_size > 1024*1024:  # Only show progress for files > 1MB
                                print(f"    Progress: {percent:.1f}%", end='\r')
            
            # Verify file was actually created and has content
            if save_path.exists() and save_path.stat().st_size > 0:
                if total_size > 1024*1024:
                    print()  # New line after progress
                return True
            else:
                print(f"  ⚠ File was not saved properly")
                if save_path.exists():
                    save_path.unlink()  # Remove empty file
                return False
                
        except requests.Timeout:
            print(f"  ✗ Timeout on attempt {attempt}/{max_retries}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)  # Exponential backoff
            continue
            
        except requests.ConnectionError as e:
            print(f"  ✗ Connection error on attempt {attempt}/{max_retries}: {str(e)[:50]}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)
            continue
            
        except requests.HTTPError as e:
            print(f"  ✗ HTTP error: {e}")
            if e.response.status_code == 404:
                return False  # Don't retry on 404
            if attempt < max_retries:
                time.sleep(2 ** attempt)
            continue
            
        except Exception as e:
            print(f"  ✗ Unexpected error on attempt {attempt}/{max_retries}: {str(e)[:100]}")
            if attempt < max_retries:
                time.sleep(1)
            continue
    
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
    
    # Get optional BASE_IMAGE_URL from environment
    base_image_url = os.getenv('BASE_IMAGE_URL', '')
    if base_image_url:
        print(f"ℹ Using base URL for relative paths: {base_image_url}")
    
    # Parse database connection parameters
    connection_params = parse_database_url(database_url)
    
    # Connect to database
    connection = connect_to_database(connection_params)
    
    # Create session with retries
    session = create_session_with_retries()
    
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
        skipped = 0
        
        for idx, product in enumerate(products, 1):
            product_id = product['product_id']
            product_name = product['product_name']
            image_path = product['image_path'].strip()
            
            # Skip empty paths
            if not image_path:
                print(f"[{idx}/{len(products)}] Skipping product {product_id}: empty image path")
                skipped += 1
                continue
            
            # Extract filename from image_path
            if '/' in image_path:
                original_filename = image_path.split('/')[-1]
            else:
                original_filename = image_path
            
            # Create a unique filename
            sanitized_name = sanitize_filename(product_name)
            file_extension = Path(original_filename).suffix or '.jpg'
            
            # Ensure we have a valid extension
            valid_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']
            if file_extension.lower() not in valid_extensions:
                file_extension = '.jpg'
            
            filename = f"{product_id}_{sanitized_name}{file_extension}"
            save_path = download_dir / filename
            
            print(f"[{idx}/{len(products)}] Processing: {product_name[:50]}...")
            print(f"  URL: {image_path[:100]}{'...' if len(image_path) > 100 else ''}")
            
            # Check if file already exists
            if save_path.exists() and save_path.stat().st_size > 0:
                print(f"  ℹ File already exists, skipping")
                skipped += 1
                continue
            
            # Try to download the image
            try:
                success = download_image(image_path, save_path, session, base_image_url)
                if success:
                    file_size = save_path.stat().st_size
                    print(f"  ✓ Downloaded successfully ({file_size:,} bytes)")
                    successful_downloads += 1
                else:
                    print(f"  ✗ Failed to download")
                    failed_downloads += 1
            except KeyboardInterrupt:
                print("\n\nDownload interrupted by user")
                break
            except Exception as e:
                print(f"  ✗ Error: {str(e)[:100]}")
                failed_downloads += 1
            
            # Small delay to avoid overwhelming the server
            if idx < len(products):
                time.sleep(0.1)
        
        # Print summary
        print("\n" + "=" * 50)
        print("Download Summary")
        print("=" * 50)
        print(f"✓ Successful downloads: {successful_downloads}")
        print(f"✗ Failed downloads: {failed_downloads}")
        print(f"ℹ Skipped: {skipped}")
        print(f"📁 Images saved to: {download_dir.absolute()}")
        
    finally:
        # Close session
        session.close()
        # Close database connection
        connection.close()
        print("\n✓ Connections closed properly")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n✗ Download interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)