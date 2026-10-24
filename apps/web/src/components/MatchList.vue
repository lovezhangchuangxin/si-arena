<script setup lang="ts">
import type { MatchDetail } from "@si-arena/protocol";
import { RouterLink, useRoute } from "vue-router";
import { session } from "../auth/session";
import { kindLabel, matchOutcome, standingChange } from "../games/match-summary";
import { gameMatchLocation } from "../games/locations";
import { shortTime } from "../utils/time";
import AppBadge from "./ui/AppBadge.vue";

defineProps<{ matches: MatchDetail[] }>();
const route = useRoute();
const tags = {
  success: "bg-accent text-on-accent",
  danger: "bg-loss text-danger-pale",
  neutral: "bg-even text-ink",
  accent: "bg-warning text-on-accent",
  warning: "bg-line text-ink",
} as const;
/** "512 : 388" for finished two-player games, own score first. */
function scoreLine(match: MatchDetail): string | null {
  if (match.kind === "arena" || match.participants.length !== 2 || !match.result) return null;
  const me = session.user?.id;
  const ordered = match.participants.toSorted(
    (a, b) => Number(b.userId === me) - Number(a.userId === me),
  );
  const scores = ordered.map(
    (seat) => match.result!.players.find((player) => player.id === seat.userId)?.score,
  );
  return scores.every((score) => score !== undefined) ? scores.join(" : ") : null;
}
function champions(match: MatchDetail) {
  return match.participants
    .filter((player) => player.rank === 1)
    .map((player) => player.username)
    .join("、");
}
function opponents(match: MatchDetail) {
  const others = match.participants.filter((p) => p.userId !== session.user?.id);
  return others.length ? others : match.participants;
}
function changeClass(change: string) {
  if (change.startsWith("+")) return "text-accent";
  if (change.startsWith("-")) return "text-danger-ink";
  return change === "—" ? "text-faint" : "text-soft";
}
</script>

<template>
  <ul class="divide-y divide-divider">
    <li v-for="match in matches" :key="match.id">
      <RouterLink
        :to="gameMatchLocation(match.gameId, match.id)"
        :aria-current="route.query.match === match.id ? 'true' : undefined"
        :class="{
          'bg-accent-soft ring-1 ring-inset ring-accent-line': route.query.match === match.id,
        }"
        class="rounded-control grid min-h-11 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-1 py-3 transition hover:bg-subtle sm:grid-cols-[5.25rem_minmax(0,1fr)_auto_1rem] sm:gap-x-4 sm:px-3"
      >
        <span
          class="rounded-[0.4375rem] py-1 text-center text-[13px] font-bold"
          :class="tags[matchOutcome(match, session.user?.id).tone]"
          >{{ matchOutcome(match, session.user?.id).label }}</span
        >
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex min-w-0 flex-wrap items-center gap-1.5 font-semibold">
            <template v-if="match.kind === 'arena' || match.participants.length > 2"
              >{{ match.participants.length }} 人局</template
            >
            <template v-else>
              对
              <span
                v-for="player in opponents(match)"
                :key="player.userId"
                class="flex min-w-0 items-center gap-1.5 break-all"
                >{{ player.username }}<AppBadge v-if="player.official" tone="outline">官方</AppBadge
                ><AppBadge v-if="player.boss" tone="danger">Boss</AppBadge></span
              >
            </template>
            <AppBadge v-if="kindLabel(match.kind)" tone="outline">{{
              kindLabel(match.kind)
            }}</AppBadge>
            <span v-if="scoreLine(match)" class="font-mono text-[13px] font-normal text-soft">{{
              scoreLine(match)
            }}</span>
          </span>
          <span
            v-if="match.kind === 'arena' && match.status === 'completed' && champions(match)"
            class="truncate text-xs text-soft"
            >冠军 {{ champions(match) }}</span
          >
          <time class="text-[13px] text-faint" :datetime="match.createdAt">{{
            shortTime(match.createdAt)
          }}</time>
        </span>
        <span
          class="text-right font-mono text-sm font-semibold tabular-nums"
          :class="changeClass(standingChange(match, session.user?.id))"
          >{{ standingChange(match, session.user?.id) }}</span
        >
        <svg
          class="hidden size-4 text-line-strong sm:block"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </RouterLink>
    </li>
  </ul>
</template>
