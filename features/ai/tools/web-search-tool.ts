import { tool } from "ai";
import { z } from "zod";

/**
 * Web search tool — lets the model fetch real-time information from Tavily
 * whenever it needs facts beyond its training data.
 */
export const webSearchTool = tool({
  description:
    "Search the web for CURRENT, real-time information only — " +
    "breaking news, today's weather, live prices, recent events, or anything " +
    "that could have changed after your training data. " +
    "Do NOT use this for general knowledge, definitions, historical facts, " +
    "coding concepts, or anything you already know confidently.",
  inputSchema: z.object({
    query: z.string().describe("The search query to look up on the web"),
  }),
  execute: async ({ query }) => {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
        search_depth: "basic",
      }),
    });

    if (!res.ok) {
      throw new Error(`Tavily search failed: ${res.status}`);
    }

    const data = await res.json();

    return {
      query,
      results: data.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })),
    };
  },
});