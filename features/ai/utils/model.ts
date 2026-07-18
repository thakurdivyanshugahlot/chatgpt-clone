// import { openai } from "@ai-sdk/openai";

// /** Default OpenAI model used when a conversation has no model override. */
// export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";

// /**
//  * Returns an OpenAI language model instance for chat completions.
//  *
//  * @param modelId - Optional model identifier; falls back to {@link DEFAULT_CHAT_MODEL}.
//  */
// export function getChatModel(modelId?: string | null) {
//     return openai(modelId || DEFAULT_CHAT_MODEL)
// }

// import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// /** NVIDIA NIM provider instance, pointed at NVIDIA's OpenAI-compatible endpoint. */
// const nvidia = createOpenAICompatible({
//     name: "nvidia",
//     baseURL: "https://integrate.api.nvidia.com/v1",
//     apiKey: process.env.NVIDIA_API_KEY,
// });

// /** Default NVIDIA NIM model used when a conversation has no model override. */
// export const DEFAULT_CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
// //nvidia/nemotron-3-super-120b-a12b   meta/llama-3.1-8b-instruct

// /**
//  * Returns an NVIDIA NIM language model instance for chat completions.
//  *
//  * @param modelId - Optional model identifier; falls back to {@link DEFAULT_CHAT_MODEL}.
//  */
// export function getChatModel(modelId?: string | null) {
//     return nvidia.chatModel(modelId || DEFAULT_CHAT_MODEL);
// }

import { google } from "@ai-sdk/google";

/** Default Gemini model used when a conversation has no model override. */
export const DEFAULT_CHAT_MODEL = "gemini-2.5-flash";

/**
 * Returns a Gemini language model instance for chat completions.
 *
 * @param modelId - Optional model identifier; falls back to {@link DEFAULT_CHAT_MODEL}.
 */
export function getChatModel(modelId?: string | null) {
    return google(modelId || DEFAULT_CHAT_MODEL);
}