# Changes to Support Directory Removal

-   **Interactive Removal**: Updated `completeAppUninstall` in `lib/system.js` to prompt the user before removing each support directory (prompts for `Application Support`, `Caches`, `Preferences`, etc.).
-   **Confirmation Logic**: Uses the existing `confirm` utility. Defaults to "y".
-   **Yes Flag Support**: `completeAppUninstall` now accepts a `yesFlag` argument. If `yesFlag` (from `--yes`) is true, these prompts are automatically confirmed.
-   **Caller Update**: Updated `lib/updater.js` to pass the `yesFlag` from `performUninstall` down to `completeAppUninstall`.

## Technical Details

-   Modified `lib/system.js`:
    -   Imported `confirm` from `./utils`.
    -   Refactored `completeAppUninstall` loop for `supportDirs`.
    -   Restored accidentally clobbered functions `findLaunchAgents` and `unloadLaunchAgent`.
-   Modified `lib/updater.js`:
    -   Updated call site for `completeAppUninstall`.
