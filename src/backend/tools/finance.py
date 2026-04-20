"""
Fetch current stock and crypto prices using free public APIs.
Uses CoinGecko for crypto and Yahoo Finance for stocks (no API key required).
"""

import requests
from typing import Optional
import time

def get_crypto_prices(
    symbols: list[str],
    currency: str = "usd"
) -> dict[str, dict]:
    """
    Fetch current prices for multiple cryptocurrencies from CoinGecko API.
    
    Args:
        symbols: List of crypto symbols (e.g., ["bitcoin", "ethereum"])
        currency: Target currency (default: "usd")
    
    Returns:
        Dictionary mapping symbols to price data
    """
    symbols_str = ",".join(symbols)
    url = "https://api.coingecko.com/api/v3/simple/price"
    params = {
        "ids": symbols_str,
        "vs_currencies": currency,
        "include_24hr_change": "true"
    }
    
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    
    data = response.json()
    result = {}
    for symbol in symbols:
        if symbol in data:
            result[symbol] = {
                "price": data[symbol].get(currency, 0),
                "change_24h_percent": data[symbol].get(f"{currency}_24h_change", 0)
            }
    return result


def get_stock_price(
    symbol: str,
    interval: str = "1d"
) -> Optional[dict]:
    url = f"https://query1.finance.yahoo.com/v7/finance/chart/{symbol}"
    params = {"interval": interval, "range": "1d"}
    
    # 1. Add a browser User-Agent to trick Yahoo into thinking you are a human
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # Pass headers to the request
    response = requests.get(url, params=params, headers=headers, timeout=10)
    
    if response.status_code != 200:
        return None
        
    data = response.json()
    try:
        result = data["chart"]["result"][0]
        meta = result["meta"]
        quote = result["indicators"]["quote"][0]
        
        return {
            "symbol": meta["symbol"],
            "name": meta.get("shortName", meta["symbol"]),
            "currency": meta.get("currency", "USD"),
            "price": meta.get("regularMarketPrice", 0),
            "open": quote.get("open", [0])[0],
            "high": quote.get("high", [0])[0],
            "low": quote.get("low", [0])[0],
            "volume": quote.get("volume", [0])[0]
        }
    except (KeyError, IndexError, TypeError):
        return None

def get_stock_prices(symbols: list[str]) -> dict[str, dict]:
    result = {}
    for symbol in symbols:
        price_data = get_stock_price(symbol)
        if price_data:
            result[symbol] = price_data
        # 2. Add a slight delay to avoid getting IP banned
        time.sleep(0.5) 
    return result

def get_major_crypto_prices(currency: str = "usd") -> dict[str, dict]:
    """
    Fetch prices for major cryptocurrencies (BTC, ETH, etc.).
    
    Args:
        currency: Target currency (default: "usd")
    
    Returns:
        Dictionary mapping crypto symbols to price data
    """
    major_cryptos = [
        "bitcoin", "ethereum", "tether", "binancecoin", 
        "solana", "ripple", "cardano", "dogecoin"
    ]
    return get_crypto_prices(major_cryptos, currency)


def get_major_stock_prices() -> dict[str, dict]:
    """
    Fetch prices for major stocks (Apple, Google, Microsoft, etc.).
    
    Returns:
        Dictionary mapping stock symbols to price data
    """
    major_stocks = [
        "AAPL", "GOOGL", "MSFT", "AMZN", "META", 
        "TSLA", "NVDA", "JPM", "V", "WMT"
    ]
    return get_stock_prices(major_stocks)


if __name__ == "__main__":
    print("=== Major Cryptocurrency Prices ===")
    crypto_prices = get_major_crypto_prices()
    for symbol, data in crypto_prices.items():
        print(f"{symbol.upper()}: ${data['price']:,.2f} (24h: {data['change_24h_percent']:.2f}%)")
    
    print("\n=== Major Stock Prices ===")
    stock_prices = get_major_stock_prices()
    for symbol, data in stock_prices.items():
        print(f"{symbol}: ${data['price']:.2f} (High: ${data['high']:.2f}, Low: ${data['low']:.2f})")