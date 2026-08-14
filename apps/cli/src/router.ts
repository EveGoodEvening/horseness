import type { CliCommandRegistryV1 } from "./registry.js";
import { INSTALL_COMMAND_V1 } from "./commands/install.js";
import { UPGRADE_COMMAND_V1 } from "./commands/upgrade.js";
import { DOWNGRADE_COMMAND_V1 } from "./commands/downgrade.js";
import { ROLLBACK_COMMAND_V1 } from "./commands/rollback.js";
import { RETRY_INSTALL_COMMAND_V1 } from "./commands/retry-install.js";
import { UNINSTALL_COMMAND_V1 } from "./commands/uninstall.js";
import { DOCTOR_COMMAND_V1 } from "./commands/doctor.js";
import { REPAIR_COMMAND_V1 } from "./commands/repair.js";
import { REBIND_WORKSPACE_COMMAND_V1 } from "./commands/rebind-workspace.js";
import { SMOKE_COMMAND_V1 } from "./commands/smoke.js";
export const INSTALLER_COMMANDS_V1 = Object.freeze([INSTALL_COMMAND_V1, UPGRADE_COMMAND_V1, DOWNGRADE_COMMAND_V1, ROLLBACK_COMMAND_V1, RETRY_INSTALL_COMMAND_V1, UNINSTALL_COMMAND_V1, DOCTOR_COMMAND_V1, REPAIR_COMMAND_V1, REBIND_WORKSPACE_COMMAND_V1, SMOKE_COMMAND_V1]);
export function registerInstallerCommandsV1(registry: CliCommandRegistryV1): void { for (const command of INSTALLER_COMMANDS_V1) registry.register(command); }
