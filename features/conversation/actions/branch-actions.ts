"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/action/require-user";
import { prisma } from "@/lib/db";
import { getOrCreateMainBranch } from "@/features/ai/actions/chat-store";

async function assertOwnsConversation(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  return conversation;
}

async function getOwnedBranch(branchId: string, userId: string) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { conversation: true },
  });
  if (!branch || branch.conversation.userId !== userId) {
    throw new Error("Branch not found");
  }
  return branch;
}

/** List all branches for a conversation, most recently updated first. */
export async function listBranches(conversationId: string) {
  const user = await requireUser();
  await assertOwnsConversation(conversationId, user.id);

  return prisma.branch.findMany({
    where: { conversationId },
    orderBy: [{ isMain: "desc" }, { updatedAt: "desc" }],
    include: {
      leafMessage: { select: { content: true, createdAt: true } },
    },
  });
}

/**
 * Creates a new branch forking from the given message. Shared history above
 * the fork point is preserved automatically via the message parentId chain —
 * only a new Branch pointer is created, no messages are copied.
 */
export async function createBranch(
  conversationId: string,
  forkMessageId: string,
  name?: string
) {
  const user = await requireUser();
  await assertOwnsConversation(conversationId, user.id);

  const forkMessage = await prisma.message.findUniqueOrThrow({
    where: { id: forkMessageId },
  });
  if (forkMessage.conversationId !== conversationId) {
    throw new Error("Message does not belong to this conversation");
  }

  const branch = await prisma.branch.create({
    data: {
      conversationId,
      name: name?.trim() || `Branch ${new Date().toLocaleString()}`,
      isMain: false,
      leafMessageId: forkMessageId,
    },
  });

  // Immediately switch to the new branch — that's the point of forking.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { activeBranchId: branch.id },
  });

  revalidatePath(`/c/${conversationId}`);
  return branch;
}

/** Switches which branch is active/open for a conversation. */
export async function switchBranch(conversationId: string, branchId: string) {
  const user = await requireUser();
  await assertOwnsConversation(conversationId, user.id);
  await getOwnedBranch(branchId, user.id);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { activeBranchId: branchId },
  });

  revalidatePath(`/c/${conversationId}`);
}

/** Renames a branch. */
export async function renameBranch(branchId: string, name: string) {
  const user = await requireUser();
  const branch = await getOwnedBranch(branchId, user.id);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Branch name cannot be empty");

  await prisma.branch.update({ where: { id: branchId }, data: { name: trimmed } });
  revalidatePath(`/c/${branch.conversationId}`);
}

/**
 * Deletes a branch pointer only — never deletes Message rows, since they may
 * be shared ancestors of other branches. If this was the active branch,
 * falls back to the conversation's main branch.
 */
export async function deleteBranch(branchId: string) {
  const user = await requireUser();
  const branch = await getOwnedBranch(branchId, user.id);

  if (branch.isMain) {
    throw new Error("Cannot delete the main branch");
  }

  await prisma.$transaction(async (tx) => {
    await tx.branch.delete({ where: { id: branchId } });

    if (branch.conversation.activeBranchId === branchId) {
      const mainBranch = await tx.branch.findFirst({
        where: { conversationId: branch.conversationId, isMain: true },
      });
      await tx.conversation.update({
        where: { id: branch.conversationId },
        data: { activeBranchId: mainBranch?.id ?? null },
      });
    }
  });

  revalidatePath(`/c/${branch.conversationId}`);
}

/** Ensures a conversation has a main branch — used from server components before first render. */
export { getOrCreateMainBranch };