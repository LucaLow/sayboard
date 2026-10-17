import { parseBoard, type Board } from "./board";

export type Classroom = { id: string; name: string };
export type ProfileSummary = {
  id: string;
  label: string;
  revision: number;
  publishedVersion: number;
};
export type ProfileDetail = ProfileSummary & {
  board: Board;
  versions: { number: number; createdAt: number }[];
  devices: { id: string; name: string; expiresAt: number }[];
};
export type ClassroomDetail = Classroom & { profiles: ProfileSummary[] };
export type DeviceBoard = {
  profileId: string;
  label: string;
  version: number;
  board: Board | null;
  csrfToken: string;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid classroom response");
  return value;
}
export function text(value: unknown, maximum = 100): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error("Enter a name within the length limit");
  return value.trim();
}
export function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw new Error("Invalid classroom identifier");
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid classroom revision");
  return value;
}
export function parseClassroom(value: unknown): Classroom {
  const row = record(value);
  return { id: id(row.id), name: text(row.name) };
}
export function parseProfileSummary(value: unknown): ProfileSummary {
  const row = record(value);
  return {
    id: id(row.id),
    label: text(row.label),
    revision: integer(row.revision),
    publishedVersion: integer(row.publishedVersion),
  };
}
export function parseClassroomDetail(value: unknown): ClassroomDetail {
  const row = record(value);
  if (!Array.isArray(row.profiles))
    throw new Error("Invalid classroom profiles");
  return {
    ...parseClassroom(row),
    profiles: row.profiles.map(parseProfileSummary),
  };
}
export function parseProfileDetail(value: unknown): ProfileDetail {
  const row = record(value);
  if (!Array.isArray(row.versions) || !Array.isArray(row.devices))
    throw new Error("Invalid classroom details");
  return {
    ...parseProfileSummary(row),
    board: parseBoard(row.board),
    versions: row.versions.map((value: unknown) => {
      const version = record(value);
      return {
        number: integer(version.number),
        createdAt: integer(version.createdAt),
      };
    }),
    devices: row.devices.map((value: unknown) => {
      const device = record(value);
      return {
        id: id(device.id),
        name: text(device.name),
        expiresAt: integer(device.expiresAt),
      };
    }),
  };
}
export function parseDeviceBoard(value: unknown): DeviceBoard {
  const row = record(value);
  const version = integer(row.version);
  const board = row.board === null ? null : parseBoard(row.board);
  if ((version === 0) !== (board === null))
    throw new Error("Invalid classroom publication");
  if (
    typeof row.csrfToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.csrfToken)
  )
    throw new Error("Invalid device session");
  return {
    profileId: id(row.profileId),
    label: text(row.label),
    version,
    board,
    csrfToken: row.csrfToken,
  };
}
