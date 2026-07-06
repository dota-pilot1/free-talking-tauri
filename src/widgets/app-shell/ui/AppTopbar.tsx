import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import type { Agent } from "../../../entities/agent/model/types";
import type { WebMenu, WebMenuId } from "../../../app/model/navigation";
import { WindowControls } from "./WindowControls";

type AppTopbarProps = {
  activeMenu: WebMenuId;
  activeWebMenu: WebMenu;
  selectedAgent: Agent;
};

export function AppTopbar({ activeMenu, activeWebMenu, selectedAgent }: AppTopbarProps) {
  const ActiveWebMenuIcon = activeWebMenu.icon;
  const title =
    activeMenu === "englishConversation"
      ? selectedAgent.title
      : activeWebMenu.label;
  const win = getCurrentWindow();
  const handleDragStart = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    void win.startDragging();
  };
  const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(".window-controls")) return;
    void win.toggleMaximize();
  };

  return (
    <header className="topbar" onMouseDown={handleDragStart} onDoubleClick={handleDoubleClick}>
      <div className="brand compact">
        <div className="brand-mark">
          <ActiveWebMenuIcon size={18} />
        </div>
        <div>
          <strong>{title}</strong>
        </div>
      </div>
      <WindowControls />
    </header>
  );
}
