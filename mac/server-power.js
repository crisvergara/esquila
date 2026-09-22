// Call after app.whenReady(). The server stays active when every window closes,
// while macOS may still turn off and lock the display. Keep the assertion across
// child restarts and cancelled quit attempts; process exit also releases it.
export function keepServerAwake(app, powerSaveBlocker) {
  const id = powerSaveBlocker.start("prevent-app-suspension");
  app.once("will-quit", () => powerSaveBlocker.stop(id));
}
