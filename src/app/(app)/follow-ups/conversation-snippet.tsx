import { MessageSquareTextIcon } from "lucide-react";

import { ACTIVITY_TYPE_LABELS } from "@/lib/constants";
import { truncateSnippet } from "@/lib/follow-ups";
import { formatOrgDateTime, formatRelativeTime } from "@/lib/time";
import type { ConversationSnippet } from "@/server/data/follow-up-views";

/** "Call · 2 days ago — “Discussed pricing…”" (latest call/conversation/note), or a muted placeholder. */
export function ConversationSnippetText({
  conversation,
  timezone,
  now,
}: {
  conversation: ConversationSnippet | null;
  timezone: string;
  now: string;
}) {
  if (!conversation) {
    return <p className="text-xs text-muted-foreground italic">No conversation logged yet</p>;
  }
  const text = truncateSnippet(conversation.snippet, undefined, conversation.contentLength);
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground" data-snippet>
      <MessageSquareTextIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">
        <span className="font-medium text-foreground/80">
          Last {ACTIVITY_TYPE_LABELS[conversation.type].toLowerCase()}
        </span>{" "}
        <time dateTime={conversation.occurredAt} title={formatOrgDateTime(conversation.occurredAt, timezone)}>
          {formatRelativeTime(conversation.occurredAt, now)}
        </time>
        : “{text}”
      </span>
    </p>
  );
}
