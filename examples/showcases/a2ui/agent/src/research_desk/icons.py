"""The icons the agent can pick for a thread.

Names match lucide icon names; the app maps each one to a drawn icon. Keep
this list in sync with `src/lib/thread-icons.tsx` in the app.
"""

THREAD_ICONS: dict[str, str] = {
    "globe": "the planet, geography, countries, global affairs",
    "thermometer": "climate, weather, temperature",
    "leaf": "nature, ecology, agriculture, food systems",
    "flask": "chemistry, lab science, experiments",
    "atom": "physics, energy, materials",
    "dna": "biology, genetics, medicine research",
    "heart-pulse": "health, medicine, fitness",
    "brain": "psychology, neuroscience, learning, AI",
    "landmark": "history, government, law, institutions",
    "scroll": "ancient history, literature, documents",
    "chart-line": "economics, markets, statistics, trends",
    "coins": "money, prices, personal finance",
    "building": "cities, housing, architecture",
    "factory": "industry, manufacturing, supply chains",
    "plane": "travel, transport, aviation",
    "rocket": "space, astronomy, exploration",
    "cpu": "computing, software, technology",
    "users": "society, demographics, people",
    "graduation-cap": "education, universities, careers",
    "music": "music, arts, entertainment",
    "book-open": "books, reading, general reference",
    "compass": "everything else, open-ended exploration",
}

DEFAULT_ICON = "compass"
