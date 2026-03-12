from agno.tools import tool


@tool
def get_weather(location: str):
    """
    Get the weather for the current location.

    Args:
        location (str): The location to get the weather for.

    Returns:
        str: The weather for the current location.
    """
    return f"The weather in {location} is: 70 degrees and Sunny."
