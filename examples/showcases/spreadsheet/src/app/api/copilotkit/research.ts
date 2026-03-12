import { TavilySearchAPIRetriever } from "@langchain/community/retrievers/tavily_search_api";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { Annotation, END, MemorySaver, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

interface AgentState {
  topic: string;
  searchResults?: string;
  article?: string;
  critique?: string;
}

const StateAnnotation = Annotation.Root({
  agentState: Annotation<AgentState>({
    value: (x: AgentState, y: AgentState) => y,
    default: () => ({
      topic: "",
    }),
  }),
});

function model() {
  return new ChatOpenAI({
    temperature: 0,
    modelName: "gpt-3.5-turbo-0125",
  });
}

async function search(state: typeof StateAnnotation.State) {
  const retriever = new TavilySearchAPIRetriever({ k: 10 });
  let topic = state.agentState.topic;
  if (topic.length < 5) topic = "topic: " + topic;
  const docs = await retriever.invoke(topic);
  return {
    agentState: { ...state.agentState, searchResults: JSON.stringify(docs) },
  };
}

async function curate(state: typeof StateAnnotation.State) {
  const response = await model().invoke(
    [
      new SystemMessage(
        'Return 5 most relevant article URLs as JSON: {urls: ["url1",...]}'
      ),
      new HumanMessage(
        `Topic: ${state.agentState.topic}\nArticles: ${state.agentState.searchResults}`
      ),
    ],
    { response_format: { type: "json_object" } }
  );

  const urls = JSON.parse(response.content as string).urls;
  const searchResults = JSON.parse(state.agentState.searchResults!);
  const filtered = searchResults.filter((r: any) =>
    urls.includes(r.metadata.source)
  );
  return {
    agentState: {
      ...state.agentState,
      searchResults: JSON.stringify(filtered),
    },
  };
}

async function write(state: typeof StateAnnotation.State) {
  const response = await model().invoke([
    new SystemMessage("Write a 5-paragraph article in markdown."),
    new HumanMessage(
      `Topic: ${state.agentState.topic}\nSources: ${state.agentState.searchResults}`
    ),
  ]);
  return {
    agentState: { ...state.agentState, article: response.content as string },
  };
}

async function critique(state: typeof StateAnnotation.State) {
  const feedback = state.agentState.critique
    ? `Previous critique: ${state.agentState.critique}`
    : "";
  const response = await model().invoke([
    new SystemMessage(
      "Review article. Return [DONE] if good, or provide brief feedback."
    ),
    new HumanMessage(`${feedback}\nArticle: ${state.agentState.article}`),
  ]);
  const content = response.content as string;
  return {
    agentState: {
      ...state.agentState,
      critique: content.includes("[DONE]") ? undefined : content,
    },
  };
}

async function revise(state: typeof StateAnnotation.State) {
  const response = await model().invoke([
    new SystemMessage("Edit article based on critique."),
    new HumanMessage(
      `Article: ${state.agentState.article}\nCritique: ${state.agentState.critique}`
    ),
  ]);
  return {
    agentState: { ...state.agentState, article: response.content as string },
  };
}

function shouldContinue(state: typeof StateAnnotation.State) {
  return state.agentState.critique === undefined ? "end" : "continue";
}

export async function createNewspaperWorkflow() {
  const workflow = new StateGraph(StateAnnotation)
    .addNode("search", new RunnableLambda({ func: search }))
    .addNode("curate", new RunnableLambda({ func: curate }))
    .addNode("write", new RunnableLambda({ func: write }))
    .addNode("critique", new RunnableLambda({ func: critique }))
    .addNode("revise", new RunnableLambda({ func: revise }))
    .addEdge("search", "curate")
    .addEdge("curate", "write")
    .addEdge("write", "critique")
    .addConditionalEdges("critique", shouldContinue, {
      continue: "revise",
      end: END,
    })
    .addEdge("revise", "critique")
    .addEdge("__start__", "search");

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

export async function researchWithLangGraph(topic: string) {
  const app = await createNewspaperWorkflow();
  const result = await app.invoke(
    { agentState: { topic } },
    {
      configurable: { thread_id: "research-" + Date.now(), checkpoint_id: "1" },
    }
  );
  return result?.agentState?.article?.replace(
    /<FEEDBACK>[\s\S]*?<\/FEEDBACK>/g,
    ""
  );
}
