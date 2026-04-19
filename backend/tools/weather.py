"""
This tool provides real-time weather information for specific cities.
"""

def get_weather(city: str, unit: str = "celsius"):
    """Fetches the current temperature of a city."""
    return f"The weather in {city} is 22 degrees {unit}."