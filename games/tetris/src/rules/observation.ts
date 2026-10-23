import { snapshotJson, type DeepReadonly } from "@si-arena/protocol";
import { TETRIS_MAX_TICKS } from "../constants";
import type { TetrisEvent, TetrisObservation, TetrisPieceType, TetrisState } from "../sdk";
import { fallInterval } from "./state";
import { readArray, readId, readInteger, readRecord } from "./validation";

/** A solo run ends at a top-out or the tick limit; the score is the result. */
export function tetrisFinished(state: DeepReadonly<TetrisState>): boolean {
  return state.over || state.tick >= state.maxTicks;
}

/** One tick yields at most a move/rotate, a hard drop with lock effects and a spawn. */
const MAX_EVENTS = 8;

function readEvents(raw: unknown, ids: readonly string[]): TetrisEvent[] {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) throw new TypeError("Invalid Tetris events");
  const playerId = (rawId: unknown) => {
    const id = readId(rawId);
    if (!ids.includes(id)) throw new TypeError("Unknown event player");
    return id;
  };
  return raw.map((item): TetrisEvent => {
    if (item === null || typeof item !== "object") throw new TypeError("Invalid event");
    const type = Object.getOwnPropertyDescriptor(item, "type")?.value;
    if (type === "spawn") {
      const event = readRecord(item, ["type", "playerId", "piece"], "spawn event");
      return { type, playerId: playerId(event.playerId), piece: readPieceType(event.piece) };
    }
    if (type === "move") {
      const event = readRecord(item, ["type", "playerId", "direction"], "move event");
      const direction = event.direction;
      if (direction !== "left" && direction !== "right" && direction !== "down")
        throw new TypeError("Invalid move event direction");
      return { type, playerId: playerId(event.playerId), direction };
    }
    if (type === "rotate") {
      const event = readRecord(item, ["type", "playerId", "rotation"], "rotate event");
      const rotation = event.rotation;
      if (rotation !== "cw" && rotation !== "ccw")
        throw new TypeError("Invalid rotate event rotation");
      return { type, playerId: playerId(event.playerId), rotation };
    }
    if (type === "hard-drop") {
      const event = readRecord(item, ["type", "playerId", "cells"], "hard-drop event");
      return {
        type,
        playerId: playerId(event.playerId),
        cells: readInteger(event.cells, 0, 20, "event cells"),
      };
    }
    if (type === "lock") {
      const event = readRecord(
        item,
        ["type", "playerId", "piece", "lines", "rows", "gain"],
        "lock event",
      );
      const lines = readInteger(event.lines, 0, 4, "event lines");
      const rows = readArray(event.rows, lines, "lock event rows").map((row) =>
        readInteger(row, 0, 19, "event row"),
      );
      if (rows.length !== new Set(rows).size)
        throw new TypeError("lock event rows must be distinct");
      return {
        type,
        playerId: playerId(event.playerId),
        piece: readPieceType(event.piece),
        lines,
        rows,
        gain: readInteger(event.gain, 0, Number.MAX_SAFE_INTEGER, "event gain"),
      };
    }
    if (type === "level-up") {
      const event = readRecord(item, ["type", "playerId", "level"], "level-up event");
      return {
        type,
        playerId: playerId(event.playerId),
        level: readInteger(event.level, 2, 999, "event level"),
      };
    }
    if (type === "top-out") {
      const event = readRecord(item, ["type", "playerId"], "top-out event");
      return { type, playerId: playerId(event.playerId) };
    }
    throw new TypeError("Unknown Tetris event type");
  });
}

function readPieceType(raw: unknown): TetrisPieceType {
  return readInteger(raw, 1, 7, "piece type");
}

export function observeTetris(
  state: DeepReadonly<TetrisState>,
  playerId: string,
  context?: { events: DeepReadonly<TetrisEvent[]> },
): TetrisObservation | null {
  if (playerId !== state.playerId) return null;
  return {
    tick: state.tick,
    maxTicks: state.maxTicks,
    selfId: playerId,
    board: { width: state.width, height: state.height, cells: state.cells.slice() },
    piece: { ...state.piece },
    next: state.queue[0]!,
    lines: state.lines,
    score: state.score,
    level: state.level,
    fallInterval: fallInterval(state.level),
    events: snapshotJson(context?.events ?? []) as TetrisEvent[],
  };
}

export function parseTetrisObservation(raw: unknown): TetrisObservation {
  const value = readRecord(
    raw,
    [
      "tick",
      "maxTicks",
      "selfId",
      "board",
      "piece",
      "next",
      "lines",
      "score",
      "level",
      "fallInterval",
      "events",
    ],
    "Tetris observation",
  );
  const board = readRecord(value.board, ["width", "height", "cells"], "board");
  if (board.width !== 10 || board.height !== 20 || value.maxTicks !== TETRIS_MAX_TICKS)
    throw new TypeError("Tetris observation must use the published board and tick limit");
  const piece = readRecord(value.piece, ["type", "rotation", "x", "y"], "piece");
  const observation = {
    tick: readInteger(value.tick, 0, TETRIS_MAX_TICKS, "observation tick"),
    maxTicks: TETRIS_MAX_TICKS,
    selfId: readId(value.selfId),
    board: {
      width: 10,
      height: 20,
      cells: readArray(board.cells, 200, "board.cells").map((cell: unknown, index: number) =>
        readInteger(cell, 0, 7, `board.cells[${index}]`),
      ),
    },
    piece: {
      type: readPieceType(piece.type),
      rotation: readInteger(piece.rotation, 0, 3, "piece.rotation"),
      x: readInteger(piece.x, -3, 9, "piece.x"),
      y: readInteger(piece.y, 0, 19, "piece.y"),
    },
    next: readPieceType(value.next),
    lines: readInteger(value.lines, 0, Number.MAX_SAFE_INTEGER, "lines"),
    score: readInteger(value.score, 0, Number.MAX_SAFE_INTEGER, "score"),
    level: readInteger(value.level, 1, 999, "level"),
    fallInterval: readInteger(value.fallInterval, 1, 12, "fallInterval"),
    events: readEvents(value.events, [readId(value.selfId)]),
  };
  if (observation.fallInterval !== fallInterval(observation.level))
    throw new TypeError("Tetris observation fallInterval must match the level");
  return snapshotJson(observation) as TetrisObservation;
}
