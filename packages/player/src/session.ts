import {
  cloneJson,
  freezeJson,
  stringifyJson,
  utf8Bytes,
  type DeepReadonly,
  type JsonValue,
  type Replay,
} from "@si-arena/protocol";
import {
  parseGameState,
  replayMatch,
  type GameDefinition,
  type ReplayTick,
  type StateContext,
} from "@si-arena/engine";

export const REPLAY_MAX_BYTES = 64 * 1024 * 1024;
export interface ReplayFrame<State, Action, Event> {
  state: DeepReadonly<State>;
  previousState: DeepReadonly<State>;
  events: DeepReadonly<Event[]>;
  /** Events of the step that produced `previousState`: the observation input at this tick. Absent when the frame was rebuilt from a checkpoint without its predecessor. */
  inputEvents?: DeepReadonly<Event[]> | undefined;
  record: DeepReadonly<ReplayTick<Action>> | null;
}
export interface SessionOptions {
  signal?: AbortSignal;
  onProgress?(completedTicks: number): void;
  yieldControl?(): Promise<void>;
  cacheBytes?: number;
}

/** A notable moment of a match, shown as a feed line and a timeline mark. */
export interface ReplayHighlight {
  /** Completed ticks when it happened. */
  tick: number;
  text: string;
  /** Optional semantics for coloring; games may use only a subset. */
  tone: "danger" | "down" | "neutral" | "up";
}

/** Trusted, game-specific wording for a tick's events; names maps player id to display name. */
export type ReplayNarrator<Event> = (
  events: DeepReadonly<Event[]>,
  names: ReadonlyMap<string, string>,
) => ReadonlyArray<Omit<ReplayHighlight, "tick">>;

/** Validates the complete match before making any state or diagnostic available to UI. */
export async function createReplaySession<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(
  raw: unknown,
  suppliedGame: GameDefinition<State, Observation, Action, Event>,
  options: SessionOptions & { narrate?: ReplayNarrator<Event> } = {},
) {
  const cancelled = () => {
    if (options.signal?.aborted) throw new Error("回放加载已取消");
  };
  cancelled();
  const game = {
    ...suppliedGame,
    manifest: cloneJson(suppliedGame.manifest),
    rules: { ...suppliedGame.rules },
  };
  await options.yieldControl?.();
  cancelled();
  // Single defensive clone: the engine validates this snapshot in place
  // (detached mode) and the session freezes it, so loading pays for one copy of
  // an untrusted replay instead of two full transient clones.
  const value = cloneJson(raw, REPLAY_MAX_BYTES);
  const cache = new Map<number, { state: DeepReadonly<State>; bytes: number }>();
  const budget = options.cacheBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(budget) || budget <= 0)
    throw new RangeError("Invalid playback cache budget");
  let cachedBytes = 0;
  const remember = (state: DeepReadonly<State>) => {
    if (cache.has(state.tick)) return;
    const bytes = utf8Bytes(stringifyJson(state, { maxBytes: REPLAY_MAX_BYTES }));
    if (bytes > budget) {
      if (state.tick === 0) throw new RangeError("Initial world exceeds playback cache budget");
      return;
    }
    while (cache.size >= 16 || cachedBytes + bytes > budget) {
      const oldest = [...cache.keys()].find((tick) => tick !== 0);
      if (oldest === undefined) return;
      cachedBytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
    cache.set(state.tick, { state, bytes });
    cachedBytes += bytes;
  };
  await options.yieldControl?.();
  cancelled();
  // Highlights come from the verifying pass itself, so they cost no extra replay.
  const highlights: ReplayHighlight[] = [];
  let names: ReadonlyMap<string, string> | undefined;
  await replayMatch(value, game, {
    detached: true,
    async onTick({ state, events }) {
      cancelled();
      if (options.narrate) {
        names ??= new Map(
          (value as Replay<State, Action>).players.map((player) => [player.id, player.name]),
        );
        for (const item of options.narrate(events, names))
          highlights.push({ tick: state.tick, ...item });
      }
      if (state.tick % 50 === 0) {
        remember(state);
        options.onProgress?.(state.tick);
        await options.yieldControl?.();
        cancelled();
      }
    },
  });
  cancelled();
  await options.yieldControl?.();
  cancelled();
  // The engine has checked every field of this detached JSON snapshot.
  const replay = freezeJson(value as Replay<State, Action>);
  const context: StateContext = freezeJson({
    config: cloneJson(replay.config),
    players: replay.players.toSorted((a, b) => a.slot - b.slot),
  });
  const initial = parseGameState(game, replay.initialState, 0, context);
  // Reserve S0 first, evicting intermediate checkpoints if needed.
  const candidates = [...cache.values()];
  cache.clear();
  cachedBytes = 0;
  remember(initial);
  for (const candidate of candidates) remember(candidate.state);
  const errorTicks = Object.freeze(
    replay.ticks.filter((tick) => Object.keys(tick.errors ?? {}).length).map((tick) => tick.tick),
  );
  const emptyEvents = freezeJson([] as Event[]);
  let last: ReplayFrame<State, Action, Event> = Object.freeze({
    state: initial,
    previousState: initial,
    events: emptyEvents,
    inputEvents: emptyEvents,
    record: null,
  });
  const frame = (completedTicks: number): ReplayFrame<State, Action, Event> => {
    if (
      !Number.isSafeInteger(completedTicks) ||
      completedTicks < 0 ||
      completedTicks > replay.ticks.length
    )
      throw new RangeError("Invalid completed tick");
    if (last.state.tick === completedTicks) return last;
    if (completedTicks === 0)
      return (last = Object.freeze({
        state: initial,
        previousState: initial,
        events: emptyEvents,
        inputEvents: emptyEvents,
        record: null,
      }));
    let state = initial;
    for (const [tick, entry] of cache) {
      if (tick < completedTicks && tick > state.tick) state = entry.state;
    }
    if (last.state.tick < completedTicks && last.state.tick > state.tick) state = last.state;
    if (cache.has(state.tick) && state.tick !== 0) {
      const entry = cache.get(state.tick)!;
      cache.delete(state.tick);
      cache.set(state.tick, entry);
    }
    while (state.tick < completedTicks) {
      const record = replay.ticks[state.tick]!;
      const output = game.rules.step(state, record.actions);
      const next = parseGameState(game, output.nextState, state.tick + 1, context);
      const events = freezeJson(cloneJson(output.events));
      // Only a frame stepped consecutively from `last` knows the events that
      // were current while its previous state was the observation input.
      const inputEvents = last.state === state ? last.events : undefined;
      last = Object.freeze({ state: next, previousState: state, events, inputEvents, record });
      state = next;
      if (state.tick % 50 === 0) remember(state);
    }
    return last;
  };
  return {
    replay,
    errorTicks,
    highlights: Object.freeze(highlights) as readonly ReplayHighlight[],
    frame,
    observation(completedTicks: number, playerId: string): Observation | null {
      const current = frame(completedTicks);
      const events = current.inputEvents ?? frame(current.previousState.tick).events;
      last = current;
      return game.rules.observe(current.previousState, playerId, { events });
    },
    get cacheInfo() {
      return { count: cache.size, bytes: cachedBytes };
    },
  };
}
