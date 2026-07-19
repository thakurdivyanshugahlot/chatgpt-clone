import {
  loadChatMessages,
  resolveActiveBranch,
  saveChatMessages,
} from "@/features/ai/actions/chat-store";
import { webSearchTool } from "@/features/ai/tools/web-search-tool";
import { getChatModel } from "@/features/ai/utils/model";
import { requireUser } from "@/features/auth/action/require-user";
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  toUIMessageStream,
  type UIMessage,
} from "ai";

export async function POST(req: Request) {
  await auth.protect();

  const { message, id, branchId }: { message: UIMessage; id: string; branchId?: string } =
    await req.json();

  if (!message || !id) {
    return new Response("Missing message or conversation id", { status: 400 });
  }

  const user = await requireUser();

  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!conversation) {
    return new Response("Conversation not found", { status: 404 });
  }

  // Resolve which branch this turn is being appended to. The client should
  // always send its current branchId, but fall back to the conversation's
  // active branch (creating `main` if this conversation predates branching).
  const branch = branchId
    ? await prisma.branch.findFirstOrThrow({ where: { id: branchId, conversationId: id } })
    : await resolveActiveBranch(id);

  const previousMessages = await loadChatMessages(id, branch.id);

  const alreadySaved = previousMessages.some(
    (storedMessage) => storedMessage.id === message.id,
  );

  const messages = alreadySaved
    ? previousMessages
    : [...previousMessages, message];

  if (!alreadySaved) {
    await saveChatMessages(id, branch.id, [message]);
  }

  const result = streamText({
    model: getChatModel(conversation.model),
    system:
      conversation.systemPrompt ?? "You are ChatGpt , a helpful assistant",
    messages: await convertToModelMessages(messages),
    tools: {
      webSearch: webSearchTool,
    },
    stopWhen: stepCountIs(5), // allows multi-step: search → then answer
    onError: ({ error }) => {
      console.error("streamText error:", error);
    },
  });

  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: async ({ messages: finalMessages }) => {
        try {
          await saveChatMessages(id, branch.id, finalMessages, { updateTitle: false });
        } catch (error) {
          console.error(error);
        }
      },
    }),
  });
}