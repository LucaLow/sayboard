import type { Board } from "../src/board.js";
import type {
  Classroom,
  ClassroomDetail,
  ProfileDetail,
  DeviceSync,
} from "../src/classroom-contract.js";

// The pilot has one adult owner per classroom. Ownership never comes from JSON.
export interface ClassroomStore {
  list(owner: string): Classroom[];
  create(owner: string, name: string): Classroom;
  detail(owner: string, classroomId: string): ClassroomDetail;
  addProfile(
    owner: string,
    classroomId: string,
    label: string,
    board: Board,
  ): ProfileDetail;
  profile(owner: string, profileId: string): ProfileDetail;
  save(
    owner: string,
    profileId: string,
    revision: number,
    board: Board,
  ): ProfileDetail;
  publish(
    owner: string,
    profileId: string,
    revision: number,
    now: number,
  ): ProfileDetail;
  restore(
    owner: string,
    profileId: string,
    revision: number,
    version: number,
  ): ProfileDetail;
  removeProfile(owner: string, profileId: string): void;
  removeClassroom(owner: string, classroomId: string): void;
  pairCode(
    owner: string,
    profileId: string,
    name: string,
    hash: string,
    now: number,
  ): void;
  pair(codeHash: string, deviceHash: string, now: number): boolean;
  device(
    hash: string,
    now: number,
  ): {
    profileId: string;
    label: string;
    version: number;
    board: Board | null;
  } | null;
  deviceSync(hash: string, now: number): Omit<DeviceSync, "csrfToken"> | null;
  applied(hash: string, version: number, now: number): void;
  unlink(hash: string): void;
  revoke(owner: string, profileId: string, deviceId: string): void;
}
