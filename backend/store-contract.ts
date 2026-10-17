import type { Board } from "../src/board.js";
import type { ClassroomStore } from "./classroom-contract.js";

export type Account = {
  id: string;
  username: string;
  passwordHash: string;
  localOnly: boolean;
};
export type Session = { account: Account; expiresAt: number };
export type SavedBoard = { board: Board; revision: number };
// Both adapters use the shared parser: v1 reads migrate in memory; writes use v2.
export interface Store {
  readonly classrooms?: ClassroomStore;
  account(username: string): Promise<Account | null>;
  session(hash: string, now: number): Promise<Session | null>;
  createSession(
    hash: string,
    accountId: string,
    expiresAt: number,
  ): Promise<void>;
  deleteSession(hash: string): Promise<void>;
  board(accountId: string): Promise<SavedBoard | null>;
  saveBoard(
    accountId: string,
    board: Board,
    revision: number,
  ): Promise<SavedBoard | null>;
  allowLogin(key: string, now: number): Promise<boolean>;
}
