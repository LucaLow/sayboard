import { describe, expect, it } from "vitest";
import { starterBoard } from "../src/board";
import {
  teacherDemoKey,
  teacherDemoPendingKey,
  readTeacherDemo,
  saveTeacherDemo,
  pendingTeacherDemo,
  clearTeacherDemoIntent,
} from "../src/teacher-demo";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
describe("teacher demo handoff", () => {
  it("keeps demo edits separate from a saved device board and requires explicit save intent", () => {
    const tab = storage();
    tab.setItem("sayboard-v2", "unrelated device board");
    const board = starterBoard();
    saveTeacherDemo(tab, board);
    expect(readTeacherDemo(tab)).toEqual(board);
    expect(pendingTeacherDemo(tab)).toBeNull();
    tab.setItem(teacherDemoPendingKey, "1");
    expect(pendingTeacherDemo(tab)).toEqual(board);
    clearTeacherDemoIntent(tab);
    expect(pendingTeacherDemo(tab)).toBeNull();
    expect(readTeacherDemo(tab)).toEqual(board);
    expect(tab.getItem("sayboard-v2")).toBe("unrelated device board");
  });
  it("rejects corrupt demo payloads without falling back to device data", () => {
    const tab = storage();
    tab.setItem("sayboard-v2", JSON.stringify(starterBoard()));
    tab.setItem(teacherDemoKey, '{"version":999}');
    tab.setItem(teacherDemoPendingKey, "1");
    expect(readTeacherDemo(tab)).toBeNull();
    expect(pendingTeacherDemo(tab)).toBeNull();
  });
  it("handles blocked tab storage without exposing an unrelated board", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
    };
    expect(readTeacherDemo(blocked)).toBeNull();
    expect(pendingTeacherDemo(blocked)).toBeNull();
    expect(() =>
      clearTeacherDemoIntent({
        removeItem() {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});
