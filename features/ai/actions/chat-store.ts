// 
"use server";

import { isTextUIPart, type UIMessage } from "ai";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

/** Extracts plain text from an AI SDK `UIMessage` by joining all text parts. */
function getMessageText(message: UIMessage) {
  return message.parts.filter(isTextUIPart).map((part) => part.text).join("");
}

/**
 * Normalizes stored message parts from the database into AI SDK `UIMessage` parts.
 * Falls back to a single text part when no structured parts are stored.
 */
function toUIMessageParts(
  parts: Prisma.JsonValue | null,
  content: string
): UIMessage["parts"] {
  const stored = parts as UIMessage["parts"] | null;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored;
  }

  return [{ type: "text", text: content }];
}

/**
 * Ensures a conversation has a `main` branch, creating one if it's missing
 * (e.g. conversations created before branching existed).
 */
export async function getOrCreateMainBranch(conversationId: string) {
  const existing = await prisma.branch.findFirst({
    where: { conversationId, isMain: true },
  });
  if (existing) return existing;

  return prisma.branch.create({
    data: { conversationId, name: "main", isMain: true },
  });
}

/**
 * Resolves which branch should be considered "active" for a conversation:
 * the conversation's `activeBranchId` if set, otherwise the main branch
 * (creating it if the conversation predates branching).
 */
export async function resolveActiveBranch(conversationId: string) {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { activeBranchId: true },
  });

  if (conversation.activeBranchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: conversation.activeBranchId },
    });
    if (branch) return branch;
  }

  return getOrCreateMainBranch(conversationId);
}

/**
 * Loads the message history for a branch (oldest -> newest) as AI SDK `UIMessage`s.
 * Walks the parent chain from the branch's leaf message. Fetches every message
 * in the conversation in a single query and walks the chain in memory, rather
 * than one query per message.
 *
 * @param conversationId - The conversation to load from.
 * @param branchId - The branch whose history to load. Defaults to the conversation's active branch.
 */
export async function loadChatMessages(
  conversationId: string,
  branchId?: string
): Promise<UIMessage[]> {
  const branch = branchId
    ? await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })
    : await resolveActiveBranch(conversationId);

  if (!branch.leafMessageId) return [];

  const rows = await prisma.message.findMany({ where: { conversationId } });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const chain: typeof rows = [];
  let currentId: string | null = branch.leafMessageId;
  while (currentId) {
    const row = byId.get(currentId);
    if (!row) break;
    chain.unshift(row);
    currentId = row.parentId;
  }

  return chain.map((row) => ({
    id: row.id,
    role: row.role === "ASSISTANT" ? "assistant" : "user",
    parts: toUIMessageParts(row.parts, row.content),
  }));
}

type SaveChatMessagesOptions = {
  updateTitle?: boolean;
};

/**
 * Upserts AI SDK `UIMessage`s into the database for a branch, chaining each
 * newly-created message to the previous one via `parentId`, and advancing
 * the branch's `leafMessageId` to the last message in the array.
 *
 * `messages` must be ordered oldest -> newest (i.e. the branch's existing
 * history followed by the new turn) — this is what `loadChatMessages` plus
 * appending the latest message produces.
 *
 * @param conversationId - Target conversation ID.
 * @param branchId - The branch these messages belong to.
 * @param messages - Messages to persist (system messages are skipped).
 * @param options.updateTitle - When true, auto-titles "New Chat" from the first user message.
 */
export async function saveChatMessages(
  conversationId: string,
  branchId: string,
  messages: UIMessage[],
  options: SaveChatMessagesOptions = {}
) {
  const { updateTitle = true } = options;

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  let previousId: string | null = branch.leafMessageId;

  for (const message of messages) {
    if (message.role === "system") continue;

    const content = getMessageText(message);
    const role = message.role === "assistant" ? "ASSISTANT" : "USER";

    await prisma.message.upsert({
      where: { id: message.id },
      create: {
        id: message.id,
        conversationId,
        parentId: previousId, // only applied on first insert; existing rows keep their original parent
        role,
        status: "COMPLETE",
        content,
        parts: message.parts as Prisma.InputJsonValue,
      },
      update: {
        content,
        parts: message.parts as Prisma.InputJsonValue,
        status: "COMPLETE",
      },
    });

    previousId = message.id;
  }

  if (previousId && previousId !== branch.leafMessageId) {
    await prisma.branch.update({
      where: { id: branchId },
      data: { leafMessageId: previousId },
    });
  }

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { title: true },
  });

  const firstUser = messages.find((message) => message.role === "user");
  const firstUserText = firstUser ? getMessageText(firstUser).trim() : "";

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      title:
        updateTitle && conversation.title === "New Chat" && firstUserText
          ? firstUserText.slice(0, 48)
          : conversation.title,
    },
  });
}