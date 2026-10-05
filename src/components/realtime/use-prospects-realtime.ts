"use client";

/**
 * Live prospect changes → one debounced callback (usually `router.refresh()`,
 * so the server re-runs its RLS-scoped, filtered query; no client-side merge).
 *
 *   useProspectsRealtime({ userId, onChange: () => router.refresh() });
 *
 * Two subscriptions on the browser (session) client, after
 * `realtime.setAuth()` so Realtime evaluates RLS as the signed-in user:
 * - `postgres_changes` on public.prospects (INSERT / UPDATE / DELETE). RLS
 *   applies to INSERT/UPDATE: a rep never receives another rep's rows. DELETE
 *   can't be RLS-checked; it carries only the primary key.
 * - the private broadcast topic `user:<userId>`: the DB trigger
 *   `prospects_broadcast_owner_change` notifies the previous owner of a
 *   reassignment (postgres_changes can't: the new row fails their RLS).
 * A re-subscribe after a dropped connection also fires (missed events).
 * Mount it once per page: the `user:<id>` topic is shared, and a new mount
 * first removes a still-leaving channel with the same topic.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

export const REALTIME_DEBOUNCE_MS = 400;

export function useProspectsRealtime({
  userId,
  onChange,
  debounceMs = REALTIME_DEBOUNCE_MS,
}: {
  userId: string;
  onChange: () => void;
  debounceMs?: number;
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = createClient();
    const channels: RealtimeChannel[] = [];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!cancelled) onChangeRef.current();
      }, debounceMs);
    };

    // After the first SUBSCRIBED, a later one means we reconnected: refresh.
    const watchStatus = () => {
      let subscribedOnce = false;
      return (status: string) => {
        if (status !== "SUBSCRIBED") return;
        if (subscribedOnce) schedule();
        subscribedOnce = true;
      };
    };

    void (async () => {
      try {
        await supabase.realtime.setAuth(); // session JWT → Realtime RLS
      } catch {
        // Not fatal: supabase-js also sets the token on connect.
      }
      if (cancelled) return;
      // A previous mount's channel may still be leaving (removeChannel is
      // async); supabase.channel() would hand it back instead of a new one.
      const userTopic = `user:${userId}`;
      const stale = supabase.getChannels().filter((channel) => channel.topic === `realtime:${userTopic}`);
      await Promise.all(stale.map((channel) => supabase.removeChannel(channel)));
      if (cancelled) return;
      channels.push(
        supabase
          .channel(`prospects-changes:${userId}:${crypto.randomUUID()}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "prospects" }, schedule)
          .subscribe(watchStatus()),
        supabase
          .channel(userTopic, { config: { private: true } })
          .on("broadcast", { event: "prospect_owner_changed" }, schedule)
          .subscribe(watchStatus()),
      );
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [userId, debounceMs]);
}
