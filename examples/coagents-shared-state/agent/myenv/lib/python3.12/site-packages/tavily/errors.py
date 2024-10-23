class UsageLimitExceededError(Exception):
    def __init__(self, message: str):
        super().__init__(message)

class BadRequestError(Exception):
    def __init__(self, message: str):
        super().__init__(message)

class InvalidAPIKeyError(Exception):
    def __init__(self):
        super().__init__("The provided API key is invalid.")
        
class MissingAPIKeyError(Exception):
    def __init__(self):
        super().__init__("No API key provided. Please provide the api_key attribute or set the TAVILY_API_KEY environment variable.")