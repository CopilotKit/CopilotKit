/**
 * This is a port of GPT Newspaper to LangGraph JS, adapted from the original Python code.
 *
 * https://github.com/assafelovic/gpt-newspaper
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, END } from "@langchain/langgraph";
import { RunnableLambda } from "@langchain/core/runnables";
import { TavilySearchAPIRetriever } from "@langchain/community/retrievers/tavily_search_api";

interface AgentState {
  topic: string;
  searchResults?: string;
  article?: string;
  critique?: string;
}

function model() {
  return new ChatOpenAI({
    temperature: 0,
    modelName: "gpt-3.5-turbo-0125",
  });
}

async function search(state: {
  agentState: AgentState;
}): Promise<{ agentState: AgentState }> {
  const retriever = new TavilySearchAPIRetriever({
    k: 10,
  });
  let topic = state.agentState.topic;
  // must be at least 5 characters long
  if (topic.length < 5) {
    topic = "topic: " + topic;
  }
  console.log("searching for topic:", topic);
  const docs = await retriever.getRelevantDocuments(topic);
  console.log("search result length:", docs.length);
  return {
    agentState: {
      ...state.agentState,
      searchResults: JSON.stringify(docs),
    },
  };
}

async function curate(state: {
  agentState: AgentState;
}): Promise<{ agentState: AgentState }> {
  console.log("curating search results");
  const response = await model().invoke(
    [
      new SystemMessage(
        `You are a personal newspaper editor. 
         Your sole task is to return a list of URLs of the 5 most relevant articles for the provided topic or query as a JSON list of strings
         in this format:
         {
          urls: ["url1", "url2", "url3", "url4", "url5"]
         }
         .`.replace(/\s+/g, " ")
      ),
      new HumanMessage(
        `Today's date is ${new Date().toLocaleDateString("en-GB")}.
       Topic or Query: ${state.agentState.topic}
       
       Here is a list of articles:
       ${state.agentState.searchResults}`.replace(/\s+/g, " ")
      ),
    ],
    {
      response_format: {
        type: "json_object",
      },
    }
  );
  const urls = JSON.parse(response.content as string).urls;
  const searchResults = JSON.parse(state.agentState.searchResults!);
  const newSearchResults = searchResults.filter((result: any) => {
    return urls.includes(result.metadata.source);
  });
  console.log("curated search results:", newSearchResults);
  return {
    agentState: {
      ...state.agentState,
      searchResults: JSON.stringify(newSearchResults),
    },
  };
}

async function critique(state: {
  agentState: AgentState;
}): Promise<{ agentState: AgentState }> {
  console.log("critiquing article");
  let feedbackInstructions = "";
  if (state.agentState.critique) {
    feedbackInstructions =
      `The writer has revised the article based on your previous critique: ${state.agentState.critique}
       The writer might have left feedback for you encoded between <FEEDBACK> tags.
       The feedback is only for you to see and will be removed from the final article.
    `.replace(/\s+/g, " ");
  }
  const response = await model().invoke([
    new SystemMessage(
      `You are a personal newspaper writing critique. Your sole purpose is to provide short feedback on a written 
      article so the writer will know what to fix.       
      Today's date is ${new Date().toLocaleDateString("en-GB")}
      Your task is to provide a really short feedback on the article only if necessary.
      if you think the article is good, please return [DONE].
      you can provide feedback on the revised article or just
      return [DONE] if you think the article is good.
      Please return a string of your critique or [DONE].`.replace(/\s+/g, " ")
    ),
    new HumanMessage(
      `${feedbackInstructions}
       This is the article: ${state.agentState.article}`
    ),
  ]);
  const content = response.content as string;
  console.log("critique:", content);
  return {
    agentState: {
      ...state.agentState,
      critique: content.includes("[DONE]") ? undefined : content,
    },
  };
}

async function write(state: {
  agentState: AgentState;
}): Promise<{ agentState: AgentState }> {
  console.log("writing article");
  const response = await model().invoke([
    new SystemMessage(
      `You are a personal newspaper writer. Your sole purpose is to write a well-written article about a 
      topic using a list of articles. Write 5 paragraphs in markdown.`.replace(
        /\s+/g,
        " "
      )
    ),
    new HumanMessage(
      `Today's date is ${new Date().toLocaleDateString("en-GB")}.
      Your task is to write a critically acclaimed article for me about the provided query or 
      topic based on the sources. 
      Here is a list of articles: ${state.agentState.searchResults}
      This is the topic: ${state.agentState.topic}
      Please return a well-written article based on the provided information.`.replace(
        /\s+/g,
        " "
      )
    ),
  ]);
  const content = response.content as string;
  console.log("article:", content);
  return {
    agentState: {
      ...state.agentState,
      article: content,
    },
  };
}

async function revise(state: {
  agentState: AgentState;
}): Promise<{ agentState: AgentState }> {
  console.log("revising article");
  const response = await model().invoke([
    new SystemMessage(
      `You are a personal newspaper editor. Your sole purpose is to edit a well-written article about a 
      topic based on given critique.`.replace(/\s+/g, " ")
    ),
    new HumanMessage(
      `Your task is to edit the article based on the critique given.
      This is the article: ${state.agentState.article}
      This is the critique: ${state.agentState.critique}
      Please return the edited article based on the critique given.
      You may leave feedback about the critique encoded between <FEEDBACK> tags like this:
      <FEEDBACK> here goes the feedback ...</FEEDBACK>`.replace(/\s+/g, " ")
    ),
  ]);
  const content = response.content as string;
  console.log("revised article:", content);
  return {
    agentState: {
      ...state.agentState,
      article: content,
    },
  };
}

const agentState = {
  agentState: {
    value: (x: AgentState, y: AgentState) => y,
    default: () => ({
      topic: "",
    }),
  },
};

// Define the function that determines whether to continue or not
const shouldContinue = (state: { agentState: AgentState }) => {
  const result = state.agentState.critique === undefined ? "end" : "continue";
  return result;
};

const workflow = new StateGraph({
  channels: agentState,
});

workflow.addNode("search", new RunnableLambda({ func: search }) as any);
workflow.addNode("curate", new RunnableLambda({ func: curate }) as any);
workflow.addNode("write", new RunnableLambda({ func: write }) as any);
workflow.addNode("critique", new RunnableLambda({ func: critique }) as any);
workflow.addNode("revise", new RunnableLambda({ func: revise }) as any);

workflow.addEdge("search", "curate");
workflow.addEdge("curate", "write");
workflow.addEdge("write", "critique");

// We now add a conditional edge
workflow.addConditionalEdges(
  // First, we define the start node. We use `agent`.
  // This means these are the edges taken after the `agent` node is called.
  "critique",
  // Next, we pass in the function that will determine which node is called next.
  shouldContinue,
  // Finally we pass in a mapping.
  // The keys are strings, and the values are other nodes.
  // END is a special node marking that the graph should finish.
  // What will happen is we will call `should_continue`, and then the output of that
  // will be matched against the keys in this mapping.
  // Based on which one it matches, that node will then be called.
  {
    // If `tools`, then we call the tool node.
    continue: "revise",
    // Otherwise we finish.
    end: END,
  }
);

workflow.addEdge("revise", "critique");

workflow.setEntryPoint("search");
const app = workflow.compile();

export async function researchWithLangGraph(topic: string) {
  const inputs = {
    agentState: {
      topic,
    },
  };
  const result = await app.invoke(inputs);
  const regex = /<FEEDBACK>[\s\S]*?<\/FEEDBACK>/g;
  const article = result.agentState.article.replace(regex, "");
  return article;
}
