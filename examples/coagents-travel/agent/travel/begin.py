users = [{
        "name": "Alice",
        "address": {
            "city": "NYC",
            "zip": "10001"
        },
        "tags": ["admin", "editor"]
    },
    {
        "name": "Bob",
        "address": {
            "city": "LA",
            "zip": "90001"
        },
        "tags": ["admin", "editor"]
    }
]

# nyc_users = [user for user in users if user["address"]["city"] == "NYC"]
# nyc_users = list(filter(lambda u: u["address"]["city"] == "NYC", users))
# nyc_users = next((user for user in users if user['address']['city'] == "NY"), "Not Here")
# print(nyc_users)

str = "Hello, world!"
users.reverse()
users.sort(key=lambda x: x["address"]["zip"])

print(list(user for user,index in enumerate(users) if index["address"]["city"] == "NYC"), "Not Here")









