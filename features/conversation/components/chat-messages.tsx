"use client";

import { isTextUIPart, type UIMessage } from "ai";
import type { ChatStatus } from "ai";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { GitBranch, Loader } from "lucide-react";
import { useCreateBranch } from "../hooks/use-branches";
;

/** Extracts plain text from a `UIMessage` by joining all text parts. */
function getMessageText(message: UIMessage) {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
}

type ChatMessagesProps = {
  messages: UIMessage[];
  status: ChatStatus;
  conversationId: string;
};

/**
 * Renders the conversation message list with markdown responses, a loading
 * indicator, and a "branch from here" action revealed on hover per message.
 */
export function ChatMessages({ messages, status, conversationId }: ChatMessagesProps) {
  const isWaiting =
    status === "submitted" && messages.at(-1)?.role === "user";

  const createBranch = useCreateBranch(conversationId);

  return (
    <Conversation>
      <ConversationContent className="py-8">
        {messages.map((message) => (
          <div key={message.id} className="group relative">
            <Message from={message.role}>
              <MessageContent>
                <MessageResponse>{getMessageText(message)}</MessageResponse>
              </MessageContent>
            </Message>

            <div className="flex justify-end pr-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                disabled={createBranch.isPending}
                onClick={() =>
                  createBranch.mutate({ forkMessageId: message.id })
                }
              >
                <GitBranch className="size-3" />
                Branch from here
              </Button>
            </div>
          </div>
        ))}

        {isWaiting ? (
          <Message from="assistant">
            <MessageContent>
              <Loader />
            </MessageContent>
          </Message>
        ) : null}
      </ConversationContent>
   
    </Conversation>
  );
}