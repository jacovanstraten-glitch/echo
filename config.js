// Application (client) ID of the Microsoft app registration used for OneDrive access.
// This is the same registration as Document Vault; its redirect URI list must include
// https://jacovanstraten-glitch.github.io/echo/
// Leave empty to enter an ID in the app on first start.
window.ECHO_CONFIG = {
  clientId: "79c2e12a-db94-4d8e-975d-e0ce908dafd4",
  // Folder in the root of your personal OneDrive, next to Document Vault
  // (on the PC: C:\Users\<you>\OneDrive\Echo; in Windows Explorer under "Jaco - Persoonlijk")
  folder: "Echo"
};
