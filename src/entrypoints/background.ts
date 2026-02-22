export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    // Extension installed - ready to use
  });
});
