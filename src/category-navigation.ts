import type { Board } from "./board";

export function createCategoryNavigation({
  board,
  activeBoardId,
  onHome,
}: {
  board: Board;
  activeBoardId: string | null;
  onHome: (categoryTileId: string | null) => void;
}): HTMLElement {
  const category = board.tiles.find(
    (tile) => tile?.kind === "category" && tile.subBoardId === activeBoardId,
  );
  const navigation = document.createElement("nav");
  navigation.className = "board-navigation";
  navigation.setAttribute("aria-label", "Board navigation");
  const home = document.createElement("button");
  home.type = "button";
  home.className = "button board-home";
  home.textContent = category ? "Back / Home" : "Home";
  home.setAttribute("aria-label", home.textContent);
  home.title = home.textContent;
  home.disabled = !category;
  home.onclick = () => onHome(category?.id ?? null);
  const heading = document.createElement("h2");
  heading.className = "board-name";
  heading.textContent = category?.label ?? "Home";
  heading.title = heading.textContent;
  navigation.append(home, heading);
  return navigation;
}
