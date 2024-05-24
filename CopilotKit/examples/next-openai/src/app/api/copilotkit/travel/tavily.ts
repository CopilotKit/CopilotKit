import OpenAI from "openai";
const TAVILY_API_KEY = "TAVILY_API_KEY";

export async function research(query: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: process.env[TAVILY_API_KEY],
      query,
      search_depth: "basic",
      include_answer: true,
      include_images: true,
      include_raw_content: false,
      max_results: 20,
    }),
  });

  const responseJson = await response.json();
  const openai = new OpenAI();

  console.log("TAVILY RESPONSE", responseJson);

  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `Summarize the following JSON to answer the research query \`"${query}"\`: ${JSON.stringify(
          responseJson,
        )} in plain English. Make sure to include the links to all images.`,
      },
    ],
    model: "gpt-4o",
  });

  console.log("SUMMARY", completion.choices[0].message.content);

  return completion.choices[0].message.content;
}
