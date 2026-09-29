import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

# Starting URL
start_url = "https://nodebox.net/code/index.php"
visited = set()
to_visit = [start_url]
base_domain = "nodebox.net"

print(f"Starting crawler from: {start_url}\n")
print("Discovered URLs under /code/:\n" + "-"*40)

while to_visit:
    current_url = to_visit.pop(0)
    
    if current_url in visited:
        continue
    
    visited.add(current_url)
    
    try:
        response = requests.get(current_url, timeout=5)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Find all anchor tags with href attributes
            for link in soup.find_all('a', href=True):
                href = link['href']
                full_url = urljoin(current_url, href)
                
                # Parse the URL to ensure it stays within the nodebox.net/code/ ecosystem
                parsed = urlparse(full_url)
                if base_domain in parsed.netloc and '/code/' in parsed.path:
                    # Strip out trailing anchors (#) to avoid duplicates
                    clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
                    
                    if clean_url not in visited and clean_url not in to_visit:
                        to_visit.append(clean_url)
                        print(clean_url)
                        
    except requests.RequestException:
        # Ignore broken links, timeouts, or connection errors during crawling
        pass

print("\n" + "-"*40)
print(f"Crawl complete. Total unique pages/files found: {len(visited)}")