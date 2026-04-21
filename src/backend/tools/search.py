import json
import time
import random
import urllib.parse
from typing import Dict, List, Optional, Any
from ddgs import DDGS

# --- AUTOMATIC GLOBAL SESSION ---
_SESSION: Optional[DDGS] = None

def get_session() -> DDGS:
    """Lazily initializes and returns a single persistent session."""
    global _SESSION
    if _SESSION is None:
        # We don't use 'with' here because we want the session to stay open
        # across multiple function calls to avoid rate limiting.
        _SESSION = DDGS()
    return _SESSION

# --- CORE SEARCH FUNCTIONS ---

def search_web(query: str, max_results: int = 10, region: str = 'us-en') -> List[Dict[str, str]]:
    """
    Search the web. Automatically manages sessions and detects news intent.
    """
    session = get_session()
    results = []
    
    # Detect if user wants news to use the better .news() backend
    news_keywords = ['news', 'breaking', 'headlines', 'current events']
    is_news = any(word in query.lower() for word in news_keywords)

    try:
        if is_news:
            search_results = session.news(
                query, 
                region=region, 
                timelimit='d', 
                max_results=max_results
            )
        else:
            search_results = session.text(
                query, 
                region=region, 
                safesearch='moderate', 
                max_results=max_results
            )
        
        # Normalize result format
        for r in search_results:
            results.append({
                'title': r.get('title', ''),
                'link': r.get('href', r.get('url', '')),
                'snippet': r.get('body', r.get('snippet', ''))
            })
            
    except Exception as e:
        # If we hit a rate limit or the connection was closed by DDG
        error_msg = str(e).lower()
        if "ratelimit" in error_msg or "403" in error_msg:
            return [{'error': 'Rate limited by DuckDuckGo. Try changing IP or waiting 5 minutes.'}]
        
        # Fallback: if News mode is empty/fails, try standard text mode
        if is_news:
            return search_web(f"{query} news", max_results=max_results, region=region)
        
        return [{'error': f'Search failed: {str(e)}'}]
    
    return results

def search_multiple_queries(queries: List[str], results_per_query: int = 5) -> Dict[str, List[Dict[str, str]]]:
    """Handles a list of queries using the shared automatic session."""
    all_results = {}
    for query in queries:
        all_results[query] = search_web(query, max_results=results_per_query)
        # Polite delay to prevent session from getting flagged
        time.sleep(random.uniform(2.0, 4.0))
    return all_results

# --- HELPER UTILITIES ---

def search_for_domains(query: str, max_results: int = 10) -> List[str]:
    """Returns unique domains found for a search query."""
    results = search_web(query, max_results=max_results)
    domains = []
    for r in results:
        if 'link' in r:
            try:
                domain = urllib.parse.urlparse(r['link']).netloc
                if domain:
                    domains.append(domain)
            except:
                continue
    # unique domains preserving order
    return list(dict.fromkeys(domains))

def search_with_filters(query: str, must_include: Optional[List[str]] = None, 
                        must_exclude: Optional[List[str]] = None) -> List[Dict[str, str]]:
    """Search and filter snippets for specific keywords."""
    raw = search_web(query)
    if not raw or 'error' in raw[0]:
        return raw
        
    filtered = []
    for r in raw:
        text = f"{r['title']} {r['snippet']}".lower()
        if must_include and not all(inc.lower() in text for inc in must_include):
            continue
        if must_exclude and any(exc.lower() in text for exc in must_exclude):
            continue
        filtered.append(r)
    return filtered
