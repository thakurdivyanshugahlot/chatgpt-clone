"use server";

import { requireUser } from "@/features/auth/action/require-user";
import { prisma } from "@/lib/db";


export async function startNewChat() {
    const user = await requireUser()

    const converation = await prisma.conversation.create({
        data:{
            userId: user.id,
            title:"New Chat"
        }
    })
    return converation.id;
}