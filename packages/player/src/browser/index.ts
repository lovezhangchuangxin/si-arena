import type { DeepReadonly, JsonValue, Replay } from "@si-arena/protocol";
import type { GameDefinition } from "@si-arena/engine";
import {
  createReplaySession,
  REPLAY_MAX_BYTES,
  type ReplayFrame,
  type ReplayHighlight,
  type ReplayNarrator,
  type SessionOptions,
} from "../session";

export type { ReplayHighlight, ReplayNarrator };

export interface ReplayPlayerSummary {
  id: string;
  label: string;
  color: string;
  score: number;
  alive: boolean;
}
export interface ReplayDrawOptions {
  /** Fraction of the current tick's animation window, 0..1; 1 draws the settled world. */
  progress: number;
  /** Host-detected prefers-reduced-motion; renderers replace transient animations with static marks. */
  reducedMotion: boolean;
}
/** A game-defined data scene for hosts that render outside canvas; shape is owned by the game renderer. */
export interface ReplayScene {
  kind: string;
}

export interface ReplayView {
  completedTicks: number;
  record: DeepReadonly<Replay<unknown, unknown>["ticks"][number]> | null;
  players: readonly ReplayPlayerSummary[];
  /** Present only for games that render a data scene instead of canvas drawing. */
  scene?(motion: ReplayDrawOptions): ReplayScene;
  draw?(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: ReplayDrawOptions,
  ): void;
  observation(playerId: string): unknown;
}
export interface BrowserReplaySession {
  aspectRatio: number;
  scoreUnit: string;
  replay: DeepReadonly<Omit<Replay<unknown, unknown>, "initialState" | "ticks">>;
  totalTicks: number;
  errorTicks: readonly number[];
  /** Game-specific notable moments, oldest first; empty when the game has no narrator. */
  highlights: readonly ReplayHighlight[];
  hasLogs: boolean;
  view(completedTicks: number): ReplayView;
}
export interface ReplayGameRegistration {
  id: string;
  release: string;
  name: string;
  load(raw: unknown, options?: SessionOptions): Promise<BrowserReplaySession>;
}
export function defineReplayGame<
  State extends { tick: number },
  Observation,
  Action extends JsonValue,
  Event,
>(options: {
  game: GameDefinition<State, Observation, Action, Event>;
  aspectRatio: number;
  scoreUnit: string;
  /** Exactly one of `draw` and `scene` renders each frame; scene games omit canvas drawing. */
  draw?(
    context: CanvasRenderingContext2D,
    frame: ReplayFrame<State, Action, Event>,
    width: number,
    height: number,
    options: ReplayDrawOptions,
  ): void;
  scene?(frame: ReplayFrame<State, Action, Event>, motion: ReplayDrawOptions): ReplayScene;
  summarize(state: DeepReadonly<State>): readonly ReplayPlayerSummary[];
  narrate?: ReplayNarrator<Event>;
}): ReplayGameRegistration {
  if (!Number.isFinite(options.aspectRatio) || options.aspectRatio <= 0)
    throw new RangeError("Invalid replay aspect ratio");
  if (!options.draw && !options.scene) throw new TypeError("Replay needs a draw or a scene");
  return {
    id: options.game.manifest.id,
    release: options.game.manifest.release,
    name: options.game.manifest.name,
    async load(raw, settings) {
      const session = await createReplaySession(raw, options.game, {
        ...settings,
        ...(options.narrate ? { narrate: options.narrate } : {}),
      });
      return {
        aspectRatio: options.aspectRatio,
        scoreUnit: options.scoreUnit,
        replay: session.replay,
        totalTicks: session.replay.ticks.length,
        errorTicks: session.errorTicks,
        highlights: session.highlights,
        hasLogs: session.replay.ticks.some(
          (record) =>
            Object.keys(record.logs ?? {}).length > 0 ||
            Object.keys(record.logsTruncated ?? {}).length > 0,
        ),
        view(completedTicks) {
          const frame = session.frame(completedTicks);
          return {
            completedTicks,
            record: frame.record,
            players: options.summarize(frame.state),
            ...(options.scene
              ? { scene: (motion: ReplayDrawOptions) => options.scene!(frame, motion) }
              : {}),
            ...(options.draw
              ? {
                  draw: (
                    context: CanvasRenderingContext2D,
                    width: number,
                    height: number,
                    drawOptions: ReplayDrawOptions,
                  ) => options.draw!(context, frame, width, height, drawOptions),
                }
              : {}),
            observation: (id) => session.observation(completedTicks, id),
          };
        },
      };
    },
  };
}

/** Browser-only bounded gzip/UTF-8 reader. No upload, network access or executable module loading. */
export async function readBrowserReplay(file: Blob, signal?: AbortSignal): Promise<unknown> {
  if (file.size > 32 * 1024 * 1024) throw new Error("回放压缩文件不能超过 32 MiB");
  if (typeof DecompressionStream === "undefined")
    throw new Error("浏览器不支持 gzip 解压，请使用新版浏览器");
  signal?.throwIfAborted();
  const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const result = await reader.read();
      signal?.throwIfAborted();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > REPLAY_MAX_BYTES) throw new Error("回放解压后不能超过 64 MiB");
      chunks.push(result.value);
    }
    // Let pending cancellation clicks land before the synchronous decode-and-parse pass.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function loadRegisteredReplay(
  raw: unknown,
  registrations: readonly ReplayGameRegistration[],
  options?: SessionOptions,
): Promise<BrowserReplaySession> {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("game" in raw) ||
    !raw.game ||
    typeof raw.game !== "object" ||
    !("id" in raw.game) ||
    !("release" in raw.game)
  )
    throw new Error("回放缺少游戏发行信息");
  const release = raw.game;
  const matches = registrations.filter(
    (entry) => entry.id === release.id && entry.release === release.release,
  );
  if (matches.length !== 1) throw new Error("未注册此游戏发行，无法播放这份回放");
  return matches[0]!.load(raw, options);
}
