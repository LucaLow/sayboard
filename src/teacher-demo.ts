import { parseBoard, serializeBoard, type Board } from "./board";

// A separate, tab-scoped copy. Trying the teacher demo must never read or
// replace the communication board saved on this device.
export const teacherDemoKey = "sayboard-teacher-demo-v1";
export function readTeacherDemo(
  storage: Pick<Storage, "getItem">,
): Board | null {
  try {
    const value = storage.getItem(teacherDemoKey);
    return value === null ? null : parseBoard(JSON.parse(value));
  } catch {
    return null;
  }
}
export function saveTeacherDemo(
  storage: Pick<Storage, "setItem">,
  board: Board,
): void {
  storage.setItem(teacherDemoKey, serializeBoard(board));
}

export const teacherDemoPendingKey = "sayboard-teacher-demo-pending";
export function pendingTeacherDemo(
  storage: Pick<Storage, "getItem">,
): Board | null {
  try {
    return storage.getItem(teacherDemoPendingKey) === "1"
      ? readTeacherDemo(storage)
      : null;
  } catch {
    return null;
  }
}
export function clearTeacherDemoIntent(
  storage: Pick<Storage, "removeItem">,
): void {
  try {
    storage.removeItem(teacherDemoPendingKey);
  } catch {
    // A blocked tab store must not turn a completed server save into an error.
  }
}
