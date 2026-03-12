FIELD_SCHEMA = (
    "FIELD SCHEMA (authoritative):\n"
    "- project.data:\n"
    "  - field1: string (text)\n"
    "  - field2: string (select: 'Option A' | 'Option B' | 'Option C')\n"
    "  - field3: string (date 'YYYY-MM-DD')\n"
    "  - field4: ChecklistItem[] where ChecklistItem={id: string, text: string, done: boolean, proposed: boolean}\n"
    "- entity.data:\n"
    "  - field1: string\n"
    "  - field2: string (select: 'Option A' | 'Option B' | 'Option C')\n"
    "  - field3: string[] (selected tags; subset of field3_options)\n"
    "  - field3_options: string[] (available tags)\n"
    "- note.data:\n"
    "  - field1: string (textarea; represents description)\n"
    "- chart.data:\n"
    "  - field1: Array<{id: string, label: string, value: number | ''}> with value in [0..100] or ''\n"
)

SYSTEM_PROMPT = """
You are an amazing story writer agent called Frankie. You have the ability to write stories based on the user's needs. But more specifically, you can pull posts from subreddits and generate stories based on them.
#RULES:
- Before generating a story from subreddit posts, you must call the frontend tool 'selectAngle' tool to allow user to select an angle for the story to be generated. 
- The angles generated should follow these set of rules:
    - The angles should be relevant to the subreddit posts that is pulled.
    - The angles should be unique and should be always one or two words.
- After the user has selected an angle, you need to generate a story based on the angle and the subreddit posts that is pulled.
- Strictly use the frontend tool 'generateStoryAndConfirm' tool to generate a story and confirm it.
- While generating the story, use a rich variety of markdown formatting to make the story more engaging and readable.
- When user asks to update the story, do rewrite the entire story, make only minor changes to the story.
"""