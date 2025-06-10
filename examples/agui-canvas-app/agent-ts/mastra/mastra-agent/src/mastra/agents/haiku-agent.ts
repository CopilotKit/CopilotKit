import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
// import { weatherTool } from '../tools/document-tool';
import { generate_haiku } from '../tools/haiku-tool';

export const haikuAgent = new Agent({
  name: 'Haiku_Agent',
  instructions: `
      You are a helpful assistant that generates haiku on a given topic.

      You assist the user in generating a haiku. When generating a haiku using the 'generate_haiku' tool, you MUST also select exactly 3 image filenames from the following list : [Bonsai_Tree_Potted_Japanese_Art_Green_Foliage.jpeg,Cherry_Blossoms_Sakura_Night_View_City_Lights_Japan.jpg,Ginkaku-ji_Silver_Pavilion_Kyoto_Japanese_Garden_Pond_Reflection.jpg,Itsukushima_Shrine_Miyajima_Floating_Torii_Gate_Sunset_Long_Exposure.jpg,Mount_Fuji_Lake_Reflection_Cherry_Blossoms_Sakura_Spring.jpg,Osaka_Castle_Turret_Stone_Wall_Pine_Trees_Daytime.jpg,Senso-ji_Temple_Asakusa_Cherry_Blossoms_Kimono_Umbrella.jpg,Shirakawa-go_Gassho-zukuri_Thatched_Roof_Village_Aerial_View.jpg,Takachiho_Gorge_Waterfall_River_Lush_Greenery_Japan.jpg,Tokyo_Skyline_Night_Tokyo_Tower_Mount_Fuji_View.jpg] that are most relevant to the haiku's content or theme. Return the filenames in the 'image_names' parameter. Dont provide the relavent image names in your final response to the user. 
`,
  model: openai('gpt-4o-mini'),
  tools: { generate_haiku },
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db', // path is relative to the .mastra/output directory
    }),
  }),
});

// export const summaryAgent = new Agent({
//   name: 'Summary Agent',
//   instructions: `
//     You are a helpful document assistant that summarizes the generated documents.

//     Your primary function is to summarize the generated documents. When responding:
//     - The response should be maximum 3 sentences.
//     - Always have an intent that here is the document on the topic that have been generated.
//   `,
//   model: openai('gpt-4o-mini'),
//   tools: { },
//   memory: new Memory({
//     storage: new LibSQLStore({
//       url: 'file:../mastra.db', // path is relative to the .mastra/output directory
//     }),
//   }),
// });
