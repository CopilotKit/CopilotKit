import OpenAI from "openai";

export async function research(query: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      include_answer: true,
      include_images: false,
      include_raw_content: false,
      max_results: 20,
    }),
  });

  const responseJson = await response.json();
  const openai = new OpenAI();

  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `Summarize the following JSON to answer the research query \`"${query}"\`: ${JSON.stringify(
          responseJson
        )} in plain English.`,
      },
    ],
    model: process.env.OPENAI_MODEL || "gpt-4",
  });

  return completion.choices[0].message.content;
}
