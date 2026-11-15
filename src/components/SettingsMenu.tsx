import type { ReactNode } from "react";
import { GearIcon } from "./icons";
import { Popover } from "./Popover";

/** ⚙ button that opens the environment / audio / quality controls in a glass panel. */
export function SettingsMenu({ children }: { children: ReactNode }) {
  return (
    <Popover label="Settings" trigger={<GearIcon />} panelClassName="settings-panel">
      {children}
    </Popover>
  );
}
